import React, { useCallback, useEffect, useRef, useState } from "react"
import { useOpenclawHub, type GwEventMessage } from "./use-openclaw-hub"

type Line = { id: string; role: string; text: string }

function extractSessions(raw: unknown): Array<{ key: string }> {
  if (!raw) return []
  let arr: unknown[] | null = null
  if (Array.isArray(raw)) arr = raw
  else if (typeof raw === "object") {
    const o = raw as Record<string, unknown>
    arr = (o.sessions ?? o.items ?? o.entries) as unknown[] | null
    if (!Array.isArray(arr) && o.snapshot && typeof o.snapshot === "object") {
      const s = (o.snapshot as Record<string, unknown>).sessions
      if (Array.isArray(s)) arr = s
    }
  }
  if (!Array.isArray(arr)) return []
  const out: Array<{ key: string }> = []
  for (const x of arr) {
    if (!x || typeof x !== "object") continue
    const o = x as Record<string, unknown>
    const key = o.key ?? o.sessionKey
    if (typeof key === "string" && key) out.push({ key })
  }
  return out
}

async function resolveSessionKey(
  rpc: (m: string, p?: Record<string, unknown>) => Promise<unknown>
): Promise<string> {
  const listRaw = await rpc("sessions.list", { limit: 40 })
  const sessions = extractSessions(listRaw)
  if (sessions.length > 0) return sessions[0].key
  const created = await rpc("sessions.create", { label: "Extension" })
  const cr = created as Record<string, unknown>
  const key = cr.key ?? cr.sessionKey
  if (typeof key === "string" && key) return key
  throw new Error("Не удалось создать сессию")
}

function contentToDisplayText(content: unknown): string {
  if (content == null) return ""
  if (typeof content === "string") {
    const t = content.trim()
    if ((t.startsWith("[") && t.endsWith("]")) || (t.startsWith("{") && t.endsWith("}"))) {
      try {
        return contentToDisplayText(JSON.parse(t) as unknown)
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
        const b = block as Record<string, unknown>
        if (typeof b.text === "string") parts.push(b.text)
        else if (b.content != null) parts.push(contentToDisplayText(b.content))
        else if (typeof b.message === "string") parts.push(b.message)
      }
    }
    return parts.join("")
  }
  if (typeof content === "object" && content !== null && "text" in content) {
    const v = (content as { text?: unknown }).text
    return typeof v === "string" ? v : contentToDisplayText(v)
  }
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function compactFallbackPayload(r: Record<string, unknown>): string {
  const o: Record<string, unknown> = { ...r }
  delete o.__openclaw
  const keys = Object.keys(o)
  if (keys.length === 0) return ""
  return JSON.stringify(o, null, 2)
}

function messageRowToText(r: Record<string, unknown>): string {
  let body = contentToDisplayText(r.content)
  if (!body.trim()) {
    body = contentToDisplayText(r.text ?? r.message ?? r.body)
  }

  const errMsg = typeof r.errorMessage === "string" ? r.errorMessage.trim() : ""
  const stopReason = typeof r.stopReason === "string" ? r.stopReason.trim() : ""
  const model = typeof r.model === "string" ? r.model.trim() : ""
  const provider =
    typeof r.provider === "string"
      ? r.provider.trim()
      : typeof r.api === "string"
        ? r.api.trim()
        : ""

  if (errMsg) {
    if (body.trim()) {
      return `${body}\n\nОшибка: ${errMsg}`
    }
    let s = `Ошибка: ${errMsg}`
    if (model) {
      s += `\nМодель: ${provider ? `${model} (${provider})` : model}`
    }
    return s
  }

  if (body.trim()) {
    return body
  }

  if (stopReason && stopReason !== "stop") {
    const meta = [model, provider].filter(Boolean).join(", ")
    return meta ? `Нет текста ответа (${stopReason}). ${meta}` : `Нет текста ответа (${stopReason}).`
  }

  if (model) {
    return `Пустой ответ. Модель: ${provider ? `${model} (${provider})` : model}`
  }

  return compactFallbackPayload(r)
}

function extractHistoryLines(raw: unknown): Line[] {
  if (!raw || typeof raw !== "object") return []
  const o = raw as Record<string, unknown>
  const rawList = o.messages ?? o.entries ?? o.items ?? o.lines ?? o.history
  if (!Array.isArray(rawList)) return []
  const lines: Line[] = []
  let i = 0
  for (const row of rawList) {
    i += 1
    if (typeof row === "string") {
      lines.push({ id: `t-${i}`, role: "log", text: contentToDisplayText(row) })
      continue
    }
    if (row && typeof row === "object") {
      const r = row as Record<string, unknown>
      const role = String(r.role ?? r.kind ?? "msg")
      const text = messageRowToText(r)
      lines.push({ id: `m-${i}-${role}`, role, text })
    }
  }
  return lines
}

function bubbleKind(role: string): string {
  const r = role.toLowerCase()
  if (r.includes("user") || r === "human") return "user"
  if (r.includes("assistant") || r.includes("agent") || r === "model") return "assistant"
  return "sys"
}

function labelRole(role: string): string {
  const k = bubbleKind(role)
  if (k === "user") return "Вы"
  if (k === "assistant") return "Агент"
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
    const sk = sessionKeyRef.current
    if (!sk) return
    try {
      const raw = await rpc("chat.history", { sessionKey: sk, limit: 200 })
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
        const sk = await resolveSessionKey(rpc)
        if (cancelled) return
        setSessionKey(sk)
        await rpc("sessions.messages.subscribe", { key: sk })
        const raw = await rpc("chat.history", { sessionKey: sk, limit: 200 })
        if (cancelled) return
        setLines(extractHistoryLines(raw))
        setSessionErr("")
      } catch (e) {
        if (!cancelled) setSessionErr(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [conn, rpc])

  useEffect(() => {
    setGatewayEventHandler((msg: GwEventMessage) => {
      const ev = msg.event.toLowerCase()
      if (
        ev.includes("chat") ||
        ev.includes("agent") ||
        ev.includes("session") ||
        ev.includes("message")
      ) {
        if (debounceRef.current) clearTimeout(debounceRef.current)
        debounceRef.current = setTimeout(() => void refreshHistory(), 350)
      }
    })
  }, [refreshHistory, setGatewayEventHandler])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  async function send() {
    const text = input.trim()
    const sk = sessionKey
    if (!text || !sk || busy) return
    setBusy(true)
    setInput("")
    try {
      await rpc("chat.send", {
        sessionKey: sk,
        message: text,
        idempotencyKey: crypto.randomUUID()
      })
      await refreshHistory()
    } catch (e) {
      setSessionErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function abortRun() {
    const sk = sessionKey
    if (!sk) return
    try {
      await rpc("chat.abort", { sessionKey: sk })
      await refreshHistory()
    } catch {}
  }

  if (conn === "connecting") {
    return (
      <div className="chat-shell chat-shell--center">
        <div className="spinner" aria-hidden />
        <p className="muted">Подключение к шлюзу…</p>
      </div>
    )
  }

  if (conn === "error") {
    return (
      <div className="chat-shell chat-shell--center">
        <p className="field-error">{connError}</p>
        <button type="button" className="btn btn--primary" onClick={() => resetGatewaySession()}>
          Повторить
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
          Обновить
        </button>
      </div>
      <div className="chat-log" ref={scrollRef}>
        {lines.length === 0 ? (
          <p className="muted chat-empty">Нет сообщений. Напишите ниже.</p>
        ) : (
          lines.map((ln) => (
            <div key={ln.id} className={`chat-bubble chat-bubble--${bubbleKind(ln.role)}`}>
              <span className="chat-role">{labelRole(ln.role)}</span>
              <pre className="chat-text">{ln.text}</pre>
            </div>
          ))
        )}
      </div>
      <div className="chat-compose">
        <textarea
          className="chat-input"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              void send()
            }
          }}
          placeholder="Сообщение (Enter — отправить, Shift+Enter — строка)"
        />
        <div className="chat-actions">
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => void abortRun()} disabled={busy}>
            Стоп
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={() => void send()}
            disabled={busy || !sessionKey}
          >
            Отправить
          </button>
        </div>
      </div>
    </div>
  )
}
