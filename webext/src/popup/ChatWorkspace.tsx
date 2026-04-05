import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { flushSync } from "react-dom"
import { useOpenclawHub, type GwEventMessage } from "./use-openclaw-hub"
import { readStoredAuth, writeStoredAuth } from "../shared/auth-storage"
import { STORAGE_SESSION_KEY } from "../shared/storage-keys"

type DisplayBlock =
  | { type: "text"; text: string }
  | { type: "image"; src: string; alt: string }

type Line = {
  id: string
  role: string
  blocks: DisplayBlock[]
  technicalText?: string
  pending?: boolean
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

function stripGatewayEnvelope(text: string): string {
  return text
    .replace(GATEWAY_ENVELOPE_RE, "")
    .replace(FAKE_DATA_IMAGE_RE, "")
    .replace(SECURITY_NOTICE_RE, "")
    .replace(EXTERNAL_WRAPPER_RE, "")
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

function mediaPathToGatewayUrl(rawPath: string, gatewayHttpBase: string): string | null {
  const normalized = rawPath.trim().replace(/\\/g, "/")

  const markers: Array<[string, string]> = [
    ["/.openclaw/media/", "/__openclaw__/media/"],
    ["/.openclaw/canvas/", "/__openclaw__/canvas/"]
  ]

  for (const [marker, mount] of markers) {
    const markerIndex = normalized.indexOf(marker)
    if (markerIndex === -1) continue

    const relative = normalized
      .slice(markerIndex + marker.length)
      .split("/")
      .filter(Boolean)
      .map((part) => encodeURIComponent(part))
      .join("/")

    if (!relative) return null
    return `${gatewayHttpBase.replace(/\/$/, "")}${mount}${relative}`
  }

  return null
}

function extractImageSrc(content: unknown, gatewayHttpBase: string): string | null {
  if (!content) return null

  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") continue
      const record = item as Record<string, unknown>
      const binary =
        typeof record.data === "string"
          ? record.data
          : typeof record.base64 === "string"
            ? record.base64
            : ""
      const mimeType =
        typeof record.mimeType === "string"
          ? record.mimeType
          : typeof record.mediaType === "string"
            ? record.mediaType
            : ""
      if (binary && mimeType.startsWith("image/")) {
        return `data:${mimeType};base64,${binary.replace(/\s+/g, "")}`
      }
    }
    for (const item of content) {
      const found = extractImageSrc(item, gatewayHttpBase)
      if (found) return found
    }
    return null
  }

  if (typeof content !== "object") return null
  const record = content as Record<string, unknown>

  const direct = [
    record.url,
    record.src,
    record.imageUrl,
    record.image_url,
    record.dataUrl,
    record.data_url
  ]
  for (const value of direct) {
    if (typeof value === "string" && /^(data:image\/|https?:\/\/)/i.test(value.trim())) {
      const normalized = value.trim().replace(/\s+/g, "")
      if (!normalized.includes("...")) return normalized
    }
  }

  const binary =
    typeof record.data === "string"
      ? record.data
      : typeof record.base64 === "string"
        ? record.base64
        : ""
  const mimeType =
    typeof record.mimeType === "string"
      ? record.mimeType
      : typeof record.mediaType === "string"
        ? record.mediaType
        : ""
  if (binary && mimeType.startsWith("image/")) {
    return `data:${mimeType};base64,${binary.replace(/\s+/g, "")}`
  }

  if (record.image && typeof record.image === "object") {
    return extractImageSrc(record.image, gatewayHttpBase)
  }

  if (record.details && typeof record.details === "object") {
    return extractImageSrc(record.details, gatewayHttpBase)
  }

  if (record.content != null) {
    return extractImageSrc(record.content, gatewayHttpBase)
  }

  const rawPaths = [
    record.imagePath,
    record.image_path,
    record.path,
    record.mediaUrl,
    record.media_url
  ]
  for (const value of rawPaths) {
    if (typeof value !== "string") continue
    const resolved = mediaPathToGatewayUrl(value, gatewayHttpBase)
    if (resolved) return resolved
  }

  if (record.media && typeof record.media === "object") {
    const mediaRecord = record.media as Record<string, unknown>
    const resolved =
      (typeof mediaRecord.mediaUrl === "string" && mediaPathToGatewayUrl(mediaRecord.mediaUrl, gatewayHttpBase)) ||
      (typeof mediaRecord.path === "string" && mediaPathToGatewayUrl(mediaRecord.path, gatewayHttpBase))
    if (resolved) return resolved
  }

  return null
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

function buildMessageLine(
  row: Record<string, unknown>,
  index: number,
  gatewayHttpBase: string
): Line | null {
  const role = String(row.role ?? row.kind ?? "msg")
  const normalizedRole = role.toLowerCase()
  const blocks: DisplayBlock[] = []

  const imageSrc = extractImageSrc(row, gatewayHttpBase)
  if (imageSrc) {
    blocks.push({ type: "image", src: imageSrc, alt: "Screenshot" })
  }

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

function extractHistoryLines(raw: unknown, gatewayHttpBase: string): Line[] {
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
      const next = buildMessageLine(row as Record<string, unknown>, index, gatewayHttpBase)
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

async function resolveSessionKey(
  rpc: (method: string, params?: Record<string, unknown>) => Promise<unknown>
): Promise<string> {
  const stored = await readStoredAuth()
  const storedKey =
    typeof stored[STORAGE_SESSION_KEY] === "string" ? stored[STORAGE_SESSION_KEY].trim() : ""
  if (storedKey) {
    try {
      await rpc("sessions.messages.subscribe", { key: storedKey })
      await rpc("chat.history", { sessionKey: storedKey, limit: 5 })
      return storedKey
    } catch {}
  }

  const created = await rpc("sessions.create", { label: `Extension ${crypto.randomUUID().slice(0, 8)}` })
  const obj = created as Record<string, unknown>
  const key = obj.key ?? obj.sessionKey
  if (typeof key === "string" && key) {
    await writeStoredAuth({ [STORAGE_SESSION_KEY]: key })
    return key
  }

  const listRaw = await rpc("sessions.list", { limit: 40 })
  const sessions = extractSessions(listRaw)
  if (sessions.length > 0) {
    await writeStoredAuth({ [STORAGE_SESSION_KEY]: sessions[0].key })
    return sessions[0].key
  }

  throw new Error("Could not create a chat session.")
}

function bubbleKind(role: string): "user" | "assistant" | "sys" {
  const normalized = role.toLowerCase()
  if (normalized.includes("user") || normalized === "human") return "user"
  if (normalized.includes("assistant") || normalized.includes("agent") || normalized === "model") {
    return "assistant"
  }
  return "sys"
}

function labelRole(role: string): string {
  const kind = bubbleKind(role)
  if (kind === "user") return "You"
  if (kind === "assistant") return "Agent"
  if (role.toLowerCase().includes("tool")) return "Browser"
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
    else if (match[4]) parts.push(/^https?:\/\//i.test(match[4]) ? { type: "link", href: match[4], label: match[4], code: true } : { type: "code", text: match[4] })
    else if (match[5]) parts.push({ type: "strong", text: match[5] })
    else if (match[6]) parts.push({ type: "link", href: match[6], label: match[6] })

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

function ChatImage(props: { src: string; alt: string }) {
  const [resolvedSrc, setResolvedSrc] = useState(props.src)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let active = true
    let objectUrl: string | null = null
    setFailed(false)
    setResolvedSrc(props.src)

    if (!props.src.startsWith("data:image/")) {
      return () => {}
    }

    void fetch(props.src)
      .then((response) => response.blob())
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (active) setResolvedSrc(objectUrl)
      })
      .catch(() => {
        if (active) setFailed(true)
      })

    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [props.src])

  if (failed) {
    return <div className="chat-image-fallback">Screenshot unavailable</div>
  }

  return (
    <figure className="chat-image-wrap">
      <a className="chat-image-open" href={resolvedSrc} target="_blank" rel="noreferrer">
        Open screenshot
      </a>
      <figcaption className="chat-image-caption">{props.alt}</figcaption>
    </figure>
  )
}

function RenderBlocks(props: { blocks: DisplayBlock[] }) {
  return (
    <div className="chat-content">
      {props.blocks.map((block, index) =>
        block.type === "image" ? (
          <ChatImage key={`${block.src}-${index}`} src={block.src} alt={block.alt} />
        ) : (
          <ChatText key={`text-${index}`} text={block.text} />
        )
      )}
    </div>
  )
}

function ChatLine(props: { line: Line }) {
  const kind = bubbleKind(props.line.role)
  return (
    <div className={`chat-bubble chat-bubble--${kind}${props.line.pending ? " chat-bubble--pending" : ""}`}>
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
  const [lines, setLines] = useState<Line[]>([])
  const [input, setInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [sessionErr, setSessionErr] = useState("")
  const scrollRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const sessionKeyRef = useRef<string | null>(null)
  const autoScrollRef = useRef(true)

  const refreshHistory = useCallback(async () => {
    const key = sessionKeyRef.current
    if (!key) return
    try {
      const raw = await rpc("chat.history", { sessionKey: key, limit: 200 })
      setLines(extractHistoryLines(raw, props.gatewayHttpBase))
      setSessionErr("")
    } catch {}
  }, [props.gatewayHttpBase, rpc])

  const createFreshSession = useCallback(async () => {
    const created = await rpc("sessions.create", { label: `Extension ${crypto.randomUUID().slice(0, 8)}` })
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
    return key
  }, [rpc])

  useEffect(() => {
    sessionKeyRef.current = sessionKey
  }, [sessionKey])

  useEffect(() => {
    if (conn !== "ready") return
    let cancelled = false

    void (async () => {
      try {
        const key = await resolveSessionKey(rpc)
        if (cancelled) return

        setSessionKey(key)
        await writeStoredAuth({ [STORAGE_SESSION_KEY]: key })
        await rpc("sessions.messages.subscribe", { key })
        const raw = await rpc("chat.history", { sessionKey: key, limit: 200 })
        if (cancelled) return

        setLines(extractHistoryLines(raw, props.gatewayHttpBase))
        setSessionErr("")
      } catch (error) {
        if (!cancelled) setSessionErr(error instanceof Error ? error.message : String(error))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [conn, props.gatewayHttpBase, rpc])

  useEffect(() => {
    setGatewayEventHandler((msg: GwEventMessage) => {
      const event = msg.event.toLowerCase()
      if (
        event.includes("chat") ||
        event.includes("agent") ||
        event.includes("session") ||
        event.includes("message")
      ) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => void refreshHistory(), 250)
      }
    })
    return () => {
      setGatewayEventHandler(() => {})
    }
  }, [refreshHistory, setGatewayEventHandler])

  useEffect(() => {
    const element = scrollRef.current
    if (element && autoScrollRef.current) {
      element.scrollTop = element.scrollHeight
    }
  }, [lines])

  async function send() {
    const text = input.trim()
    const key = sessionKey
    if (!text || !key || busy) return

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
      blocks: [{ type: "text", text: "Думаю..." }]
    }

    flushSync(() => {
      setBusy(true)
      setInput("")
      autoScrollRef.current = true
      setLines((current) => current.concat(optimisticUser, pendingAssistant))
    })
    try {
      await rpc("chat.send", {
        sessionKey: key,
        message: text,
        idempotencyKey: crypto.randomUUID()
      })
      await refreshHistory()
    } catch (error) {
      setLines((current) => current.filter((line) => !line.pending))
      setSessionErr(error instanceof Error ? error.message : String(error))
    } finally {
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
          <button type="button" className="btn-inline" onClick={() => void refreshHistory()}>
            Refresh
          </button>
        </div>
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
            disabled={busy || !sessionKey}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
