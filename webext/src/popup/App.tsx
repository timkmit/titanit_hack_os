import React, { useCallback, useEffect, useState } from "react"
import { ChatWorkspace } from "./ChatWorkspace"
import {
  STORAGE_GATEWAY_TOKEN,
  STORAGE_SETUP,
  STORAGE_URL
} from "../shared/storage-keys"

const DEFAULT_URL = import.meta.env.VITE_OPENCLAW_URL || "http://localhost:18789"

function normalizeUrl(raw: string): string {
  let value = raw.trim()
  if (!value) return value
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`
  }
  return value
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:"
  } catch {
    return false
  }
}

function gatewayHealthUrl(base: string): string {
  return `${base.replace(/\/$/, "")}/healthz`
}

async function checkGatewayReachable(base: string): Promise<boolean> {
  try {
    const response = await fetch(gatewayHealthUrl(base), { method: "GET", cache: "no-store" })
    return response.ok
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
    const storedToken =
      typeof data[STORAGE_GATEWAY_TOKEN] === "string" ? data[STORAGE_GATEWAY_TOKEN] : ""

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
      setError("Enter a valid gateway URL, for example http://localhost:18789.")
      return
    }

    if (!token) {
      setError("Enter the gateway token from OPENCLAW_GATEWAY_TOKEN.")
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
    void chrome.storage.sync.get(STORAGE_GATEWAY_TOKEN).then((data) => {
      const token = data[STORAGE_GATEWAY_TOKEN]
      setTempToken(typeof token === "string" ? token : "")
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
        <p className="muted">Loading...</p>
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
                The extension connects directly to your OpenClaw gateway over WebSocket.
              </p>
            </div>
          </div>

          <label className="field-label" htmlFor="oc-url">
            Gateway URL
          </label>
          <input
            id="oc-url"
            className="field-input"
            type="text"
            value={tempUrl}
            onChange={(event) => {
              setTempUrl(event.target.value)
              setError("")
            }}
            placeholder={DEFAULT_URL}
            autoComplete="url"
            spellCheck={false}
            aria-invalid={!!error}
          />

          <label className="field-label" htmlFor="oc-token" style={{ marginTop: 14 }}>
            Gateway token
          </label>
          <input
            id="oc-token"
            className="field-input"
            type="password"
            value={tempToken}
            onChange={(event) => {
              setTempToken(event.target.value)
              setError("")
            }}
            placeholder="OPENCLAW_GATEWAY_TOKEN"
            autoComplete="off"
            spellCheck={false}
          />

          {error ? <p className="field-error">{error}</p> : null}
          <p className="field-hint">
            Use the same value that you put into <code className="inline-code">OPENCLAW_GATEWAY_TOKEN</code>.
          </p>

          <div className="setup-actions">
            {fromMain ? (
              <button type="button" className="btn btn--ghost" onClick={cancelSettings}>
                Back
              </button>
            ) : null}
            <button type="button" className="btn btn--primary" onClick={() => void handleConnect()}>
              {fromMain ? "Save" : "Connect"}
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
            title="Open full Control UI"
            aria-label="Open full Control UI"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={openSettings}
            title="Open settings"
            aria-label="Open settings"
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
                <span>Checking HTTP...</span>
              ) : health === "ok" ? (
                <span>Gateway online</span>
              ) : (
                <span>HTTP unavailable</span>
              )}
            </div>
            <button type="button" className="btn-inline btn-inline--dim" onClick={recheckHealth}>
              Retry
            </button>
          </div>
          <ChatWorkspace gatewayHttpBase={url} />
        </>
      ) : (
        <main className="main-hub">
          <div className="frame-fallback">
            <p>The saved gateway URL is not reachable.</p>
            <button type="button" className="btn btn--primary" onClick={openSettings}>
              Open settings
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
