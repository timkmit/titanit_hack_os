import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useOpenclawHub, type GwEventMessage } from "./use-openclaw-hub"
import { readStoredAuth, writeStoredAuth } from "../shared/auth-storage"
import { STORAGE_SESSION_KEY } from "../shared/storage-keys"

type DisplayBlock = { type: "text"; text: string }

type Line = {
  id: string
  role: string
  blocks: DisplayBlock[]
  technicalText?: string
  pending?: boolean
}

type BrowserMediaItem = {
  name: string
  size: number
  mtimeMs: number
  url: string
}

type SessionSummary = {
  key: string
  label: string
}

const GATEWAY_ENVELOPE_RE =
  /^Sender \(untrusted metadata\):\s*```json[\s\S]*?```\s*\n*\[[^\]]+UTC\]\s*/i
const INLINE_PART_RE =
  /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|<(https?:\/\/[^>\s]+)>|`([^`]+)`|\*\*([^*]+)\*\*|(https?:\/\/[^\s)]+)/g
const FAKE_DATA_IMAGE_RE = /!\[[^\]]*]\(data:image\/[^)]*\)/gi
const SECURITY_NOTICE_RE =
  /SECURITY NOTICE:[\s\S]*?<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\s*/i
const EXTERNAL_WRAPPER_RE =
  /<<<EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>\s*Source:[^\n]*\n---\n?|<<<END_EXTERNAL_UNTRUSTED_CONTENT[^>]*>>>/g
const PSEUDO_TOOL_RE =
  /```browser[\s\S]*?```|^\s*browser\(.*\)\s*\$result\s*$|^\s*\$result\.[^\n]*$/gim

const PENDING_ASSISTANT_PLACEHOLDER = "Думаю..."

function mergeStreamDisplayText(prev: string, next: string): string {
  const base = prev === PENDING_ASSISTANT_PLACEHOLDER ? "" : prev
  if (!next) return prev
  if (!base) return next
  if (next.startsWith(base)) return next
  if (base.startsWith(next) && next.length > 0) return base
  return base + next
}

function messageRoleLower(message: unknown): string {
  if (!message || typeof message !== "object") return ""
  const r = (message as Record<string, unknown>).role
  return typeof r === "string" ? r.toLowerCase() : ""
}

function extractChatEventStreamText(payload: Record<string, unknown>): string | null {
  if (payload.message != null) {
    const role = messageRoleLower(payload.message)
    if (role.includes("user") || role === "human") return null
    const t = contentToDisplayText(payload.message)
    if (t) return t
  }
  for (const key of ["text", "chunk", "delta"] as const) {
    const v = payload[key]
    if (typeof v === "string" && v.trim()) return stripGatewayEnvelope(v)
  }
  return null
}

function extractAgentEventStreamText(payload: Record<string, unknown>): string | null {
  const data =
    payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null
  if (data?.message != null) {
    const role = messageRoleLower(data.message)
    if (!role.includes("user") && role !== "human") {
      const t = contentToDisplayText(data.message)
      if (t) return t
    }
  }
  const nested = data ?? payload
  for (const key of ["text", "delta", "chunk", "token"] as const) {
    const v = nested[key]
    if (typeof v === "string" && v.trim()) return stripGatewayEnvelope(v)
  }
  return null
}

function sessionKeyFromAgentPayload(payload: Record<string, unknown>): string {
  const data =
    payload.data && typeof payload.data === "object" ? (payload.data as Record<string, unknown>) : null
  const fromData = data && typeof data.sessionKey === "string" ? data.sessionKey : ""
  if (fromData) return fromData
  return typeof payload.sessionKey === "string" ? payload.sessionKey : ""
}

function findLastPendingAssistantIndex(lines: Line[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.pending && line.role.toLowerCase().includes("assistant")) return i
  }
  return -1
}

function buildSessionLabelFromPrompt(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (!normalized) return "New chat"
  return normalized.slice(0, 60)
}

function deriveApiBase(gatewayHttpBase: string): string {
  try {
    const gatewayUrl = new URL(gatewayHttpBase)
    const apiUrl = new URL(gatewayUrl.toString())
    apiUrl.port = gatewayUrl.port === "18789" ? "8000" : gatewayUrl.port
    apiUrl.pathname = ""
    apiUrl.search = ""
    apiUrl.hash = ""
    return apiUrl.toString().replace(/\/$/, "")
  } catch {
    return "http://localhost:8000"
  }
}

async function fetchLatestBrowserScreenshot(
  apiBase: string,
  minMtimeMs: number
): Promise<BrowserMediaItem | null> {
  const response = await fetch(`${apiBase}/api/media/browser`, { cache: "no-store" })
  if (!response.ok) return null
  const raw = (await response.json()) as { items?: BrowserMediaItem[] }
  const items = Array.isArray(raw.items) ? raw.items : []
  const latest = items.find((item) => typeof item.mtimeMs === "number" && item.mtimeMs >= minMtimeMs)
  return latest ?? null
}

function stripGatewayEnvelope(text: string): string {
  return text
    .replace(GATEWAY_ENVELOPE_RE, "")
    .replace(FAKE_DATA_IMAGE_RE, "")
    .replace(SECURITY_NOTICE_RE, "")
    .replace(EXTERNAL_WRAPPER_RE, "")
    .replace(PSEUDO_TOOL_RE, "")
    .replace(/^\)\s*$/gm, "")
    .replace(/\r/g, "")
    .trim()
}

function looksLikeJsonPayload(text: string): boolean {
  const trimmed = text.trim()
  return (
    (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
    (trimmed.startsWith("[") && trimmed.endsWith("]"))
  )
}

function tryParseJson(text: string): unknown | null {
  if (!looksLikeJsonPayload(text)) return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function contentToDisplayText(content: unknown): string {
  if (content == null) return ""

  if (typeof content === "string") {
    const parsed = tryParseJson(content)
    if (parsed != null) return contentToDisplayText(parsed)
    return stripGatewayEnvelope(content)
  }

  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const item of content) {
      if (item == null || typeof item !== "object") {
        if (item != null) parts.push(String(item))
        continue
      }

      const record = item as Record<string, unknown>
      if (record.type === "toolCall" || record.type === "image") continue

      if (typeof record.text === "string") {
        const text = stripGatewayEnvelope(record.text)
        if (text && !looksLikeJsonPayload(text)) parts.push(text)
        continue
      }

      if (record.content != null) {
        const nested = contentToDisplayText(record.content)
        if (nested) parts.push(nested)
        continue
      }

      if (typeof record.message === "string") {
        const text = stripGatewayEnvelope(record.message)
        if (text && !looksLikeJsonPayload(text)) parts.push(text)
      }
    }
    return parts.join("\n").trim()
  }

  if (typeof content === "object") {
    const record = content as Record<string, unknown>
    if (record.type === "toolCall") return ""
    if (typeof record.text === "string") return stripGatewayEnvelope(record.text)
    if (typeof record.message === "string") return stripGatewayEnvelope(record.message)
    if (record.content != null) return contentToDisplayText(record.content)
  }

  return String(content)
}

function compactTechnicalText(row: Record<string, unknown>): string {
  const parts: string[] = []

  if (Array.isArray(row.content)) {
    for (const item of row.content) {
      if (!item || typeof item !== "object") continue
      const record = item as Record<string, unknown>
      if (record.type !== "toolCall") continue

      const toolName = typeof record.name === "string" ? record.name : "tool"
      parts.push(`Tool: ${toolName}`)

      const args =
        record.arguments && typeof record.arguments === "object"
          ? (record.arguments as Record<string, unknown>)
          : null
      if (args) {
        for (const [label, key] of [
          ["Action", "action"],
          ["URL", "url"],
          ["Target", "targetId"],
          ["Ref", "ref"],
          ["Profile", "profile"],
          ["Text", "text"]
        ] as const) {
          const value = args[key]
          if (typeof value === "string" && value.trim()) parts.push(`${label}: ${value.trim()}`)
        }
      }
    }
  }

  if (row.role?.toString().toLowerCase().includes("tool")) {
    const details = row.details && typeof row.details === "object" ? (row.details as Record<string, unknown>) : null
    if (details) {
      const toolName =
        typeof details.toolName === "string"
          ? details.toolName
          : typeof row.toolName === "string"
            ? row.toolName
            : typeof row.toolCallId === "string"
              ? "browser"
              : ""
      if (toolName) parts.push(`Tool: ${toolName}`)
      if (typeof details.url === "string") parts.push(`URL: ${details.url}`)
      if (typeof details.targetId === "string") parts.push(`Target: ${details.targetId}`)
      if (typeof details.error === "string") parts.push(`Error: ${details.error}`)
      if (typeof details.errorMessage === "string") parts.push(`Error: ${details.errorMessage}`)
    }
  }

  return parts.join("\n").trim()
}

function buildMessageLine(row: Record<string, unknown>, index: number): Line | null {
  const role = String(row.role ?? row.kind ?? "msg")
  const normalizedRole = role.toLowerCase()
  const blocks: DisplayBlock[] = []

  const body = contentToDisplayText(row.content ?? row.text ?? row.message ?? row.body)
  if (body && !normalizedRole.includes("tool")) {
    blocks.push({ type: "text", text: body })
  }

  const errorMessage = typeof row.errorMessage === "string" ? row.errorMessage.trim() : ""
  if (errorMessage) {
    blocks.push({ type: "text", text: `Error: ${errorMessage}` })
  }

  const stopReason = typeof row.stopReason === "string" ? row.stopReason.trim() : ""
  const model = typeof row.model === "string" ? row.model.trim() : ""
  const provider =
    typeof row.provider === "string"
      ? row.provider.trim()
      : typeof row.api === "string"
        ? row.api.trim()
        : ""
  const technicalText = compactTechnicalText(row)

  if (stopReason === "toolUse" && blocks.length === 0) return null

  if (blocks.length === 0 && stopReason && stopReason !== "stop" && stopReason !== "toolUse") {
    const meta = [model, provider].filter(Boolean).join(", ")
    blocks.push({
      type: "text",
      text: meta ? `No response text (${stopReason}). ${meta}` : `No response text (${stopReason}).`
    })
  }

  if (blocks.length === 0 && !technicalText) return null

  return {
    id: typeof row.id === "string" ? `msg-${row.id}` : `m-${index}-${role}`,
    role,
    blocks,
    technicalText: technicalText || undefined
  }
}

function extractHistoryLines(raw: unknown): Line[] {
  if (!raw || typeof raw !== "object") return []
  const record = raw as Record<string, unknown>
  const rawList = record.messages ?? record.entries ?? record.items ?? record.lines ?? record.history
  if (!Array.isArray(rawList)) return []

  const lines: Line[] = []
  let index = 0
  for (const row of rawList) {
    index += 1

    if (typeof row === "string") {
      const text = contentToDisplayText(row)
      if (text) lines.push({ id: `t-${index}`, role: "log", blocks: [{ type: "text", text }] })
      continue
    }

    if (row && typeof row === "object") {
      const next = buildMessageLine(row as Record<string, unknown>, index)
      if (next) lines.push(next)
    }
  }

  return lines
}

function extractSessions(raw: unknown): Array<{ key: string }> {
  if (!raw) return []
  let sessions: unknown[] | null = null
  if (Array.isArray(raw)) {
    sessions = raw
  } else if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    sessions = (obj.sessions ?? obj.items ?? obj.entries) as unknown[] | null
    if (!Array.isArray(sessions) && obj.snapshot && typeof obj.snapshot === "object") {
      const snapshotSessions = (obj.snapshot as Record<string, unknown>).sessions
      if (Array.isArray(snapshotSessions)) sessions = snapshotSessions
    }
  }

  if (!Array.isArray(sessions)) return []

  const result: Array<{ key: string }> = []
  for (const entry of sessions) {
    if (!entry || typeof entry !== "object") continue
    const obj = entry as Record<string, unknown>
    const key = obj.key ?? obj.sessionKey
    if (typeof key === "string" && key) result.push({ key })
  }
  return result
}

function extractSessionSummaries(raw: unknown): SessionSummary[] {
  if (!raw) return []
  let sessions: unknown[] | null = null
  if (Array.isArray(raw)) {
    sessions = raw
  } else if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>
    sessions = (obj.sessions ?? obj.items ?? obj.entries) as unknown[] | null
    if (!Array.isArray(sessions) && obj.snapshot && typeof obj.snapshot === "object") {
      const snapshotSessions = (obj.snapshot as Record<string, unknown>).sessions
      if (Array.isArray(snapshotSessions)) sessions = snapshotSessions
    }
  }

  if (!Array.isArray(sessions)) return []

  return sessions
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === "object")
    .map((entry, index) => {
      const key = entry.key ?? entry.sessionKey
      const label = entry.label ?? entry.title ?? entry.name ?? `Chat ${index + 1}`
      return {
        key: typeof key === "string" ? key : "",
        label: typeof label === "string" && label.trim() ? label.trim() : `Chat ${index + 1}`
      }
    })
    .filter((entry) => entry.key)
}

async function resolveStoredSessionKey(
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
): Promise<string | null> {
  const stored = await readStoredAuth()
  const storedKey =
    typeof stored[STORAGE_SESSION_KEY] === "string" ? stored[STORAGE_SESSION_KEY].trim() : ""
  if (!storedKey) return null
  try {
    await rpc("sessions.messages.subscribe", { key: storedKey })
  } catch {
    // ignr
  }
  return storedKey
}

function bubbleKind(role: string): "user" | "assistant" | "sys" {
  const normalized = role.toLowerCase()
  if (normalized.includes("user") || normalized === "human") return "user"
  if (normalized.includes("assistant") || normalized.includes("agent") || normalized === "model") {
    return "assistant"
  }
  return "sys"
}

function linePrimaryText(line: Line): string {
  const b = line.blocks[0]
  return b?.type === "text" ? b.text : ""
}

function normalizeForHistoryMatch(text: string): string {
  return stripGatewayEnvelope(text).replace(/\s+/g, " ").trim()
}

function mergeServerHistoryWithPending(previous: Line[], server: Line[]): Line[] {
  const pending = previous.filter((l) => l.pending)
  if (pending.length === 0) return server

  let merged = server.slice()
  for (const p of pending) {
    const raw = linePrimaryText(p)
    const plain = normalizeForHistoryMatch(raw)
    const kind = bubbleKind(p.role)

    if (kind === "user") {
      if (plain.length === 0) continue
      const onServer = merged.some((l) => {
        if (bubbleKind(l.role) !== "user") return false
        const t = normalizeForHistoryMatch(linePrimaryText(l))
        return t.includes(plain) || plain.includes(t)
      })
      if (!onServer) merged.push(p)
      continue
    }

    if (kind === "assistant") {
      if (raw === PENDING_ASSISTANT_PLACEHOLDER || !plain) {
        const last = merged[merged.length - 1]
        const lastIsUser = last != null && bubbleKind(last.role) === "user"
        if (lastIsUser) {
          merged.push(p)
          continue
        }
        const lastA = [...merged].reverse().find((l) => bubbleKind(l.role) === "assistant")
        const lt = lastA ? normalizeForHistoryMatch(linePrimaryText(lastA)) : ""
        if (!lastA || lt.length < 2) merged.push(p)
        continue
      }

      const lastA = [...merged].reverse().find((l) => bubbleKind(l.role) === "assistant")
      const serverPlain = lastA ? normalizeForHistoryMatch(linePrimaryText(lastA)) : ""
      if (!lastA || serverPlain.length < plain.length) {
        merged.push(p)
      }
    }
  }

  return merged
}

function growPendingAssistantFromServerHistory(previous: Line[], server: Line[]): Line[] {
  const idx = findLastPendingAssistantIndex(previous)
  if (idx < 0) return previous

  const lastSrv = [...server].reverse().find((l) => bubbleKind(l.role) === "assistant")
  if (!lastSrv) return previous

  const srvRaw = linePrimaryText(lastSrv)
  if (!srvRaw.trim()) return previous

  const line = previous[idx]
  const prevRaw = linePrimaryText(line)
  const prevNorm = normalizeForHistoryMatch(prevRaw)
  const srvNorm = normalizeForHistoryMatch(srvRaw)

  if (prevRaw === PENDING_ASSISTANT_PLACEHOLDER) {
    if (srvNorm.length === 0) return previous
  } else if (srvNorm.length <= prevNorm.length) {
    return previous
  }

  const next = previous.slice()
  next[idx] = { ...line, blocks: [{ type: "text", text: srvRaw }] }
  return next
}

function labelRole(role: string): string {
  const kind = bubbleKind(role)
  if (kind === "user") return "You"
  if (kind === "assistant") return "Agent"
  if (role.toLowerCase().includes("tool")) return "Browser"
  if (role.toLowerCase() === "browser") return "Browser"
  return role
}

function parseInlineParts(text: string) {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "link"; href: string; label: string; code?: boolean }
    | { type: "code"; text: string }
    | { type: "strong"; text: string }
  > = []
  let lastIndex = 0
  INLINE_PART_RE.lastIndex = 0

  for (const match of text.matchAll(INLINE_PART_RE)) {
    const index = match.index ?? 0
    if (index > lastIndex) parts.push({ type: "text", text: text.slice(lastIndex, index) })

    if (match[1] && match[2]) parts.push({ type: "link", href: match[2], label: match[1] })
    else if (match[3]) parts.push({ type: "link", href: match[3], label: match[3] })
    else if (match[4]) {
      parts.push(
        /^https?:\/\//i.test(match[4])
          ? { type: "link", href: match[4], label: match[4], code: true }
          : { type: "code", text: match[4] }
      )
    } else if (match[5]) {
      parts.push({ type: "strong", text: match[5] })
    } else if (match[6]) {
      parts.push({ type: "link", href: match[6], label: match[6] })
    }

    lastIndex = index + match[0].length
  }

  if (lastIndex < text.length) parts.push({ type: "text", text: text.slice(lastIndex) })
  return parts
}

function ChatText(props: { text: string }) {
  const lines = useMemo(() => props.text.split("\n"), [props.text])
  return (
    <div className="chat-text">
      {lines.map((line, index) => (
        <div key={`line-${index}`} className="chat-text-line">
          {line.length === 0 ? (
            <br />
          ) : (
            parseInlineParts(line).map((part, partIndex) => {
              const key = `part-${index}-${partIndex}`
              if (part.type === "text") return <React.Fragment key={key}>{part.text}</React.Fragment>
              if (part.type === "strong") return <strong key={key} className="chat-strong">{part.text}</strong>
              if (part.type === "code") return <code key={key} className="chat-code">{part.text}</code>
              return (
                <a
                  key={key}
                  className={`chat-link${part.code ? " chat-link--code" : ""}`}
                  href={part.href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {part.code ? <code className="chat-code">{part.label}</code> : part.label}
                </a>
              )
            })
          )}
        </div>
      ))}
    </div>
  )
}

function RenderBlocks(props: { blocks: DisplayBlock[] }) {
  return (
    <div className="chat-content">
      {props.blocks.map((block, index) => (
        <ChatText key={`text-${index}`} text={block.text} />
      ))}
    </div>
  )
}

function ChatLine(props: { line: Line }) {
  const kind = bubbleKind(props.line.role)
  const streaming =
    props.line.pending &&
    kind === "assistant" &&
    props.line.blocks[0]?.type === "text" &&
    props.line.blocks[0].text !== PENDING_ASSISTANT_PLACEHOLDER
  return (
    <div
      className={`chat-bubble chat-bubble--${kind}${props.line.pending ? " chat-bubble--pending" : ""}${streaming ? " chat-bubble--streaming" : ""}`}
    >
      <span className="chat-role">{labelRole(props.line.role)}</span>
      <RenderBlocks blocks={props.line.blocks} />
      {props.line.technicalText ? (
        <details className="chat-technical">
          <summary className="chat-technical-summary">
            {props.line.role.toLowerCase().includes("tool") ? "Browser details" : "Tool details"}
          </summary>
          <div className="chat-technical-body">
            <ChatText text={props.line.technicalText} />
          </div>
        </details>
      ) : null}
    </div>
  )
}

export function ChatWorkspace(props: { gatewayHttpBase: string }) {
  const { conn, connError, rpc, resetGatewaySession, setGatewayEventHandler } = useOpenclawHub()
  const [sessionKey, setSessionKey] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [sessionErr, setSessionErr] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const streamPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionKeyRef = useRef<string | null>(null)
  const autoScrollRef = useRef(true)
  const screenshotSinceRef = useRef<number | null>(null)
  const lastScreenshotNameRef = useRef<string | null>(null)
  const streamSeqRef = useRef<{ runId: string; seq: number }>({ runId: "", seq: -1 })
  const busyRef = useRef(false)
  const apiBase = deriveApiBase(props.gatewayHttpBase)

  const refreshHistory = useCallback(
    async (opts?: { force?: boolean; streamingPoll?: boolean }) => {
      const key = sessionKeyRef.current
      if (!key) return
      const allowDuringBusy = opts?.force === true || opts?.streamingPoll === true
      if (!allowDuringBusy && busyRef.current) return
      try {
        const raw = await rpc("chat.history", { sessionKey: key, limit: 200 })
        let nextLines = extractHistoryLines(raw)
        const screenshotSince = screenshotSinceRef.current
        if (screenshotSince != null) {
          try {
            const latestScreenshot = await fetchLatestBrowserScreenshot(apiBase, screenshotSince)
            if (latestScreenshot && latestScreenshot.name !== lastScreenshotNameRef.current) {
              lastScreenshotNameRef.current = latestScreenshot.name
              nextLines = nextLines.concat({
                id: `shot-${latestScreenshot.name}`,
                role: "browser",
                blocks: [
                  {
                    type: "text",
                    text: `Screenshot: ${apiBase}${latestScreenshot.url}`
                  }
                ]
              })
              screenshotSinceRef.current = null
            }
          } catch {}
        }
        setLines((cur) => {
          if (nextLines.length === 0 && cur.length > 0 && opts?.streamingPoll) {
            return cur
          }
          const grown = growPendingAssistantFromServerHistory(cur, nextLines)
          return mergeServerHistoryWithPending(grown, nextLines)
        })
        setSessionErr("")
      } catch {}
    },
    [apiBase, rpc]
  )

  const refreshSessions = useCallback(async () => {
    try {
      const raw = await rpc("sessions.list", { limit: 40 })
      const nextSessions = extractSessionSummaries(raw)
      setSessions(nextSessions)
    } catch {}
  }, [rpc])

  const openSession = useCallback(
    async (key: string) => {
      await writeStoredAuth({ [STORAGE_SESSION_KEY]: key })
      await rpc("sessions.messages.subscribe", { key })
      sessionKeyRef.current = key
      setSessionKey(key)
      const raw = await rpc("chat.history", { sessionKey: key, limit: 200 })
      setLines(extractHistoryLines(raw))
      setSessionErr("")
    },
    [rpc]
  )

  const createFreshSession = useCallback(async (label = `New chat ${crypto.randomUUID().slice(0, 4)}`) => {
    const created = await rpc("sessions.create", { label })
    const obj = created as Record<string, unknown>
    const key = obj.key ?? obj.sessionKey
    if (typeof key !== "string" || !key) {
      throw new Error("Could not create a new chat session.")
    }
    await writeStoredAuth({ [STORAGE_SESSION_KEY]: key })
    await rpc("sessions.messages.subscribe", { key })
    sessionKeyRef.current = key
    setSessionKey(key)
    setLines([])
    setSessionErr("")
    await refreshSessions()
    return key
  }, [refreshSessions, rpc])

  useEffect(() => {
    sessionKeyRef.current = sessionKey
  }, [sessionKey])

  useEffect(() => {
    if (conn !== "ready") return
    let cancelled = false

    void (async () => {
      try {
        await refreshSessions()
        const key = await resolveStoredSessionKey(rpc)
        if (cancelled) return
        if (key) {
          sessionKeyRef.current = key
          setSessionKey(key)
          await writeStoredAuth({ [STORAGE_SESSION_KEY]: key })
          try {
            await rpc("sessions.messages.subscribe", { key })
          } catch {
            /* key already validated in resolveStoredSessionKey */
          }
          try {
            await rpc("sessions.subscribe")
          } catch {
            /* optional: session index events */
          }
          const raw = await rpc("chat.history", { sessionKey: key, limit: 200 })
          if (cancelled) return
          const initialLines = extractHistoryLines(raw)
          setLines(initialLines)
          if (initialLines.length === 0) {
            setTimeout(() => {
              if (cancelled) return
              void refreshHistory({ force: true })
            }, 150)
          }
        } else {
          setSessionKey(null)
          setLines([])
        }
        setSessionErr("")
      } catch (error) {
        if (!cancelled) setSessionErr(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [conn, refreshHistory, refreshSessions, rpc])

  useEffect(() => {
    setGatewayEventHandler((msg: GwEventMessage) => {
      const eventRaw = msg.event
      const event = eventRaw.toLowerCase()

      const isChatPayloadEvent =
        eventRaw === "chat" ||
        (eventRaw.startsWith("chat.") && !eventRaw.toLowerCase().includes("side_result"))

      if (isChatPayloadEvent && msg.payload && typeof msg.payload === "object") {
        const p = msg.payload as Record<string, unknown>
        const sk = typeof p.sessionKey === "string" ? p.sessionKey : ""
        const currentKey = sessionKeyRef.current
        if (sk && currentKey && sk === currentKey) {
          const state = typeof p.state === "string" ? p.state.toLowerCase() : ""
          const runId = typeof p.runId === "string" ? p.runId : ""
          const seq = typeof p.seq === "number" ? p.seq : -1

          if (state === "final" || state === "error" || state === "aborted") {
            streamSeqRef.current = { runId: "", seq: -1 }
            if (debounceRef.current) clearTimeout(debounceRef.current)
            debounceRef.current = setTimeout(() => void refreshHistory({ force: true }), 80)
            return
          }

          const treatAsDelta = state === "delta" || (!state && p.message != null)
          if (treatAsDelta) {
            if (runId && seq >= 0) {
              const last = streamSeqRef.current
              if (last.runId === runId && seq < last.seq) {
                return
              }
              streamSeqRef.current = { runId, seq }
            }
            const text = extractChatEventStreamText(p)
            if (text) {
              setLines((lines) => {
                const i = findLastPendingAssistantIndex(lines)
                if (i < 0) return lines
                const line = lines[i]
                const prev = line.blocks[0]?.type === "text" ? line.blocks[0].text : ""
                const merged = mergeStreamDisplayText(prev, text)
                if (merged === prev) return lines
                const next = lines.slice()
                next[i] = { ...line, blocks: [{ type: "text", text: merged }] }
                return next
              })
              return
            }
          }
        }
      }

      if (event === "agent" && msg.payload && typeof msg.payload === "object") {
        const p = msg.payload as Record<string, unknown>
        const sk = sessionKeyFromAgentPayload(p)
        if (sk && sessionKeyRef.current && sk === sessionKeyRef.current) {
          const stream = typeof p.stream === "string" ? p.stream.toLowerCase() : ""
          if (stream.includes("tool")) {
            // ignr
          } else {
            const runId = typeof p.runId === "string" ? p.runId : ""
            const seq = typeof p.seq === "number" ? p.seq : -1
            if (runId && seq >= 0) {
              const last = streamSeqRef.current
              if (last.runId === runId && seq < last.seq) {
                return
              }
              streamSeqRef.current = { runId, seq }
            }
            const text = extractAgentEventStreamText(p)
            if (text) {
              setLines((lines) => {
                const i = findLastPendingAssistantIndex(lines)
                if (i < 0) return lines
                const line = lines[i]
                const prev = line.blocks[0]?.type === "text" ? line.blocks[0].text : ""
                const merged = mergeStreamDisplayText(prev, text)
                if (merged === prev) return lines
                const next = lines.slice()
                next[i] = { ...line, blocks: [{ type: "text", text: merged }] }
                return next
              })
              return
            }
          }
        }
      }

      if (
        event.includes("chat") ||
        event.includes("agent") ||
        event.includes("session") ||
        event.includes("message")
      ) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => void refreshHistory(), 250)
        if (event.includes("session")) {
          void refreshSessions()
        }
      }
    })
    return () => {
      setGatewayEventHandler(() => {})
    }
  }, [refreshHistory, refreshSessions, setGatewayEventHandler])

  useEffect(() => {
    const element = scrollRef.current
    if (element && autoScrollRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [lines])

  async function send() {
    const text = input.trim()
    if (!text || busy) return

    const optimisticUser: Line = {
      id: `pending-user-${crypto.randomUUID()}`,
      role: "user",
      pending: true,
      blocks: [{ type: "text", text }]
    }
    const pendingAssistant: Line = {
      id: `pending-agent-${crypto.randomUUID()}`,
      role: "assistant",
      pending: true,
      blocks: [{ type: "text", text: PENDING_ASSISTANT_PLACEHOLDER }]
    }

    screenshotSinceRef.current = Date.now()
    streamSeqRef.current = { runId: "", seq: -1 }

    flushSync(() => {
      busyRef.current = true
      setBusy(true)
      setInput("")
      autoScrollRef.current = true
      setLines((current) => current.concat(optimisticUser, pendingAssistant))
    })

    try {
      let key = sessionKey
      if (!key) {
        key = await createFreshSession(buildSessionLabelFromPrompt(text))
      }

      if (streamPollRef.current) clearInterval(streamPollRef.current)
      streamPollRef.current = setInterval(() => {
        void refreshHistory({ streamingPoll: true })
      }, 280)

      const sendPromise = rpc("chat.send", {
        sessionKey: key,
        message: text,
        idempotencyKey: crypto.randomUUID()
      })
      setTimeout(() => {
        void refreshHistory({ streamingPoll: true })
      }, 300)
      await sendPromise
      await refreshHistory({ force: true })
      await refreshSessions()
    } catch (error) {
      setLines((current) => current.filter((line) => !line.pending))
      setSessionErr(error instanceof Error ? error.message : String(error))
    } finally {
      if (streamPollRef.current) {
        clearInterval(streamPollRef.current)
        streamPollRef.current = null
      }
      busyRef.current = false
      setBusy(false)
    }
  }

  async function abortRun() {
    const key = sessionKey
    if (!key) return
    try {
      await rpc("chat.abort", { sessionKey: key })
      await refreshHistory()
    } catch {}
  }

  useEffect(() => {
    return () => {
      if (streamPollRef.current) {
        clearInterval(streamPollRef.current)
        streamPollRef.current = null
      }
    }
  }, [])

  if (conn === "connecting") {
    return (
      <div className="chat-shell chat-shell--center">
        <div className="spinner" aria-hidden />
        <p className="muted">Connecting to gateway...</p>
      </div>
    )
  }

  if (conn === "error") {
    return (
      <div className="chat-shell chat-shell--center">
        <p className="field-error">{connError}</p>
        <button type="button" className="btn btn--primary" onClick={() => resetGatewaySession()}>
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="chat-shell">
      {sessionErr ? <p className="chat-banner field-error">{sessionErr}</p> : null}
      <div className="chat-meta">
        <span className="muted">WS | {props.gatewayHttpBase.replace(/^https?:\/\//, "")}</span>
        <div className="chat-meta-actions">
          <button type="button" className="btn-inline" onClick={() => void createFreshSession()} disabled={busy}>
            New chat
          </button>
          <button type="button" className="btn-inline" onClick={() => void refreshHistory({ force: true })}>
            Refresh
          </button>
        </div>
      </div>
      <div className="chat-history-bar">
        <label className="chat-history-label" htmlFor="chat-session-select">
          History
        </label>
        <select
          id="chat-session-select"
          className="chat-session-select"
          value={sessionKey ?? ""}
          onChange={(event) => {
            const nextKey = event.target.value
            if (!nextKey || nextKey === sessionKey) return
            void openSession(nextKey)
          }}
        >
          {sessions.length === 0 ? <option value="">No chats yet</option> : null}
          {sessions.map((session) => (
            <option key={session.key} value={session.key}>
              {session.label}
            </option>
          ))}
        </select>
      </div>
      <div
        className="chat-log"
        ref={scrollRef}
        onScroll={(event) => {
          const element = event.currentTarget
          const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight
          autoScrollRef.current = distanceFromBottom < 48
        }}
      >
        {lines.length === 0 ? (
          <p className="muted chat-empty">No messages yet. Send a prompt below.</p>
        ) : (
          lines.map((line) => <ChatLine key={line.id} line={line} />)
        )}
      </div>
      <div className="chat-compose">
        <textarea
          className="chat-input"
          rows={3}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          placeholder="Message (Enter to send, Shift+Enter for a new line)"
        />
        <div className="chat-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void abortRun()} disabled={busy}>
            Stop
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void send()}
            disabled={busy}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
