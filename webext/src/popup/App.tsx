import React, { useCallback, useEffect, useState } from "react"
import { ChatWorkspace } from "./ChatWorkspace"
import {
  STORAGE_GATEWAY_TOKEN,
  STORAGE_SETUP,
  STORAGE_URL
} from "../shared/storage-keys"

const DEFAULT_URL = import.meta.env.VITE_OPENCLAW_URL || "http://localhost:18789"

function normalizeUrl(raw: string): string {
  let s = raw.trim()
  if (!s) return s
  if (!/^https?:\/\//i.test(s)) {
    s = `http://${s}`
  }
  return s
}

function isValidHttpUrl(s: string): boolean {
  try {
    const u = new URL(s)
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

function gatewayHealthUrl(base: string): string {
  return `${base.replace(/\/$/, "")}/healthz`
}

async function checkGatewayReachable(base: string): Promise<boolean> {
  try {
    const res = await fetch(gatewayHealthUrl(base), { method: "GET", cache: "no-store" })
    return res.ok
  } catch {
    return false
  }
}

export function App() {
  const [phase, setPhase] = useState<"loading" | "setup" | "main">("loading")
  const [url, setUrl] = useState("")
  const [tempUrl, setTempUrl] = useState("")
  const [tempToken, setTempToken] = useState("")
  const [error, setError] = useState("")
  const [fromMain, setFromMain] = useState(false)
  const [health, setHealth] = useState<"checking" | "ok" | "fail">("checking")

  const load = useCallback(async () => {
    const data = await chrome.storage.sync.get([STORAGE_URL, STORAGE_SETUP, STORAGE_GATEWAY_TOKEN])
    const storedUrl = typeof data[STORAGE_URL] === "string" ? data[STORAGE_URL] : ""
    const storedToken = typeof data[STORAGE_GATEWAY_TOKEN] === "string" ? data[STORAGE_GATEWAY_TOKEN] : ""
    let setupDone = data[STORAGE_SETUP] === true
    if (data[STORAGE_SETUP] === undefined && storedUrl.length > 0 && storedToken.length > 0) {
      setupDone = true
      await chrome.storage.sync.set({ [STORAGE_SETUP]: true })
    }
    setUrl(storedUrl)
    setTempUrl(storedUrl || DEFAULT_URL)
    setTempToken(storedToken)
    setPhase(setupDone && storedUrl && storedToken ? "main" : "setup")
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (phase !== "main" || !isValidHttpUrl(url)) return
    let cancelled = false
    setHealth("checking")
    void checkGatewayReachable(url).then((ok) => {
      if (!cancelled) setHealth(ok ? "ok" : "fail")
    })
    return () => {
      cancelled = true
    }
  }, [phase, url])

  function openControlUiTab() {
    chrome.tabs.create({ url })
  }

  function recheckHealth() {
    if (!isValidHttpUrl(url)) return
    setHealth("checking")
    void checkGatewayReachable(url).then((ok) => setHealth(ok ? "ok" : "fail"))
  }

  async function handleConnect() {
    const normalized = normalizeUrl(tempUrl)
    const token = tempToken.trim()
    if (!normalized || !isValidHttpUrl(normalized)) {
      setError("Укажите корректный адрес, например http://localhost:18789")
      return
    }
    if (!token) {
      setError("Нужен токен шлюза (OPENCLAW_GATEWAY_TOKEN из .env / docker-compose)")
      return
    }
    setError("")
    await chrome.storage.sync.set({
      [STORAGE_URL]: normalized,
      [STORAGE_GATEWAY_TOKEN]: token,
      [STORAGE_SETUP]: true
    })
    setUrl(normalized)
    setFromMain(false)
    setPhase("main")
  }

  function openSettings() {
    setFromMain(true)
    setTempUrl(url)
    void chrome.storage.sync.get(STORAGE_GATEWAY_TOKEN).then((d) => {
      const t = d[STORAGE_GATEWAY_TOKEN]
      setTempToken(typeof t === "string" ? t : "")
    })
    setError("")
    setPhase("setup")
  }

  function cancelSettings() {
    setFromMain(false)
    setError("")
    setPhase("main")
  }

  if (phase === "loading") {
    return (
      <div className="shell shell--center">
        <div className="spinner" aria-hidden />
        <p className="muted">Загрузка…</p>
      </div>
    )
  }

  if (phase === "setup") {
    return (
      <div className="shell shell--setup">
        <div className="setup-card">
          <div className="setup-brand">
            <div className="setup-logo" aria-hidden />
            <div>
              <h1 className="setup-title">OpenClaw</h1>
              <p className="setup-subtitle">
                URL шлюза и секретный токен — расширение подключается по WebSocket напрямую.
              </p>
            </div>
          </div>

          <label className="field-label" htmlFor="oc-url">
            URL сервера
          </label>
          <input
            id="oc-url"
            className="field-input"
            type="text"
            value={tempUrl}
            onChange={(e) => {
              setTempUrl(e.target.value)
              setError("")
            }}
            placeholder={DEFAULT_URL}
            autoComplete="url"
            spellCheck={false}
            aria-invalid={!!error}
          />

          <label className="field-label" htmlFor="oc-token" style={{ marginTop: 14 }}>
            Токен шлюза
          </label>
          <input
            id="oc-token"
            className="field-input"
            type="password"
            value={tempToken}
            onChange={(e) => {
              setTempToken(e.target.value)
              setError("")
            }}
            placeholder="OPENCLAW_GATEWAY_TOKEN"
            autoComplete="off"
            spellCheck={false}
          />

          {error ? <p className="field-error">{error}</p> : null}
          <p className="field-hint">
            Тот же токен, что задан в <code className="inline-code">OPENCLAW_GATEWAY_TOKEN</code> для контейнера
            openclaw-gateway.
          </p>

          <div className="setup-actions">
            {fromMain ? (
              <button type="button" className="btn btn--ghost" onClick={cancelSettings}>
                Назад
              </button>
            ) : null}
            <button type="button" className="btn btn--primary" onClick={() => void handleConnect()}>
              {fromMain ? "Сохранить" : "Подключиться"}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="shell shell--main">
      <header className="main-bar">
        <span className="main-bar-title">OpenClaw</span>
        <div className="main-bar-actions">
          <button
            type="button"
            className="icon-btn"
            onClick={openControlUiTab}
            title="Полный Control UI во вкладке"
            aria-label="Открыть полный Control UI"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={openSettings}
            title="Изменить адрес и токен"
            aria-label="Настройки"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>
        </div>
      </header>

      {isValidHttpUrl(url) ? (
        <>
          <div className="hub-strip">
            <div className={`hub-status hub-status--${health} hub-status--compact`}>
              <span className="hub-status-dot" aria-hidden />
              {health === "checking" ? (
                <span>HTTP…</span>
              ) : health === "ok" ? (
                <span>Шлюз на месте</span>
              ) : (
                <span>HTTP недоступен</span>
              )}
            </div>
            <button type="button" className="btn-inline btn-inline--dim" onClick={recheckHealth}>
              Проверить
            </button>
          </div>
          <ChatWorkspace gatewayHttpBase={url} />
        </>
      ) : (
        <main className="main-hub">
          <div className="frame-fallback">
            <p>Сохранённый адрес недоступен.</p>
            <button type="button" className="btn btn--primary" onClick={openSettings}>
              Задать адрес
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
