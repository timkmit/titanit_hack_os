import React, { useCallback, useEffect, useRef, useState } from "react"
import { useOpenclawHub, type GwEventMessage } from "./use-openclaw-hub"

type Line = { id: string; role: string; text: string }

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
  const listRaw = await rpc("sessions.list", { limit: 40 })
  const sessions = extractSessions(listRaw)
  if (sessions.length > 0) return sessions[0].key

  const created = await rpc("sessions.create", { label: "Extension" })
  const obj = created as Record<string, unknown>
  const key = obj.key ?? obj.sessionKey
  if (typeof key === "string" && key) return key

  throw new Error("Could not create a chat session.")
}

function contentToDisplayText(content: unknown): string {
  if (content == null) return ""
  if (typeof content === "string") {
    const trimmed = content.trim()
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        return contentToDisplayText(JSON.parse(trimmed) as unknown)
      } catch {
        return content
      }
    }
    return content
  }

  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const block of content) {
      if (block == null) continue
      if (typeof block === "string") {
        parts.push(block)
        continue
      }
      if (typeof block === "object") {
        const obj = block as Record<string, unknown>
        if (typeof obj.text === "string") parts.push(obj.text)
        else if (obj.content != null) parts.push(contentToDisplayText(obj.content))
        else if (typeof obj.message === "string") parts.push(obj.message)
      }
    }
    return parts.join("")
  }

  if (typeof content === "object" && content !== null && "text" in content) {
    const text = (content as { text?: unknown }).text
    return typeof text === "string" ? text : contentToDisplayText(text)
  }

  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function compactFallbackPayload(row: Record<string, unknown>): string {
  const payload: Record<string, unknown> = { ...row }
  delete payload.__openclaw
  const keys = Object.keys(payload)
  if (keys.length === 0) return ""
  return JSON.stringify(payload, null, 2)
}

function messageRowToText(row: Record<string, unknown>): string {
  let body = contentToDisplayText(row.content)
  if (!body.trim()) {
    body = contentToDisplayText(row.text ?? row.message ?? row.body)
  }

  const errorMessage = typeof row.errorMessage === "string" ? row.errorMessage.trim() : ""
  const stopReason = typeof row.stopReason === "string" ? row.stopReason.trim() : ""
  const model = typeof row.model === "string" ? row.model.trim() : ""
  const provider =
    typeof row.provider === "string"
      ? row.provider.trim()
      : typeof row.api === "string"
        ? row.api.trim()
        : ""

  if (errorMessage) {
    if (body.trim()) {
      return `${body}\n\nError: ${errorMessage}`
    }
    let result = `Error: ${errorMessage}`
    if (model) {
      result += `\nModel: ${provider ? `${model} (${provider})` : model}`
    }
    return result
  }

  if (body.trim()) return body

  if (stopReason && stopReason !== "stop") {
    const meta = [model, provider].filter(Boolean).join(", ")
    return meta ? `No response text (${stopReason}). ${meta}` : `No response text (${stopReason}).`
  }

  if (model) {
    return `Empty response. Model: ${provider ? `${model} (${provider})` : model}`
  }

  return compactFallbackPayload(row)
}

function extractHistoryLines(raw: unknown): Line[] {
  if (!raw || typeof raw !== "object") return []
  const obj = raw as Record<string, unknown>
  const rawList = obj.messages ?? obj.entries ?? obj.items ?? obj.lines ?? obj.history
  if (!Array.isArray(rawList)) return []

  const lines: Line[] = []
  let index = 0
  for (const row of rawList) {
    index += 1
    if (typeof row === "string") {
      lines.push({ id: `t-${index}`, role: "log", text: contentToDisplayText(row) })
      continue
    }
    if (row && typeof row === "object") {
      const objRow = row as Record<string, unknown>
      const role = String(objRow.role ?? objRow.kind ?? "msg")
      const text = messageRowToText(objRow)
      lines.push({ id: `m-${index}-${role}`, role, text })
    }
  }

  return lines
}

function bubbleKind(role: string): "user" | "assistant" | "sys" {
  const normalized = role.toLowerCase()
  if (normalized.includes("user") || normalized === "human") return "user"
  if (
    normalized.includes("assistant") ||
    normalized.includes("agent") ||
    normalized === "model"
  ) {
    return "assistant"
  }
  return "sys"
}

function labelRole(role: string): string {
  const kind = bubbleKind(role)
  if (kind === "user") return "You"
  if (kind === "assistant") return "Agent"
  return role
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

  const refreshHistory = useCallback(async () => {
    const key = sessionKeyRef.current
    if (!key) return
    try {
      const raw = await rpc("chat.history", { sessionKey: key, limit: 200 })
      setLines(extractHistoryLines(raw))
      setSessionErr("")
    } catch {}
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
        await rpc("sessions.messages.subscribe", { key })
        const raw = await rpc("chat.history", { sessionKey: key, limit: 200 })
        if (cancelled) return

        setLines(extractHistoryLines(raw))
        setSessionErr("")
      } catch (error) {
        if (!cancelled) {
          setSessionErr(error instanceof Error ? error.message : String(error))
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [conn, rpc])

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
        debounceRef.current = setTimeout(() => void refreshHistory(), 350)
      }
    })
  }, [refreshHistory, setGatewayEventHandler])

  useEffect(() => {
    const element = scrollRef.current
    if (element) element.scrollTop = element.scrollHeight
  }, [lines])

  async function send() {
    const text = input.trim()
    const key = sessionKey
    if (!text || !key || busy) return

    setBusy(true)
    setInput("")
    try {
      await rpc("chat.send", {
        sessionKey: key,
        message: text,
        idempotencyKey: crypto.randomUUID()
      })
      await refreshHistory()
    } catch (error) {
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
        <span className="muted">WS · {props.gatewayHttpBase.replace(/^https?:\/\//, "")}</span>
        <button type="button" className="btn-inline" onClick={() => void refreshHistory()}>
          Refresh
        </button>
      </div>
      <div className="chat-log" ref={scrollRef}>
        {lines.length === 0 ? (
          <p className="muted chat-empty">No messages yet. Send a prompt below.</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className={`chat-bubble chat-bubble--${bubbleKind(line.role)}`}>
              <span className="chat-role">{labelRole(line.role)}</span>
              <pre className="chat-text">{line.text}</pre>
            </div>
          ))
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
