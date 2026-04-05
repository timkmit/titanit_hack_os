import React, { useCallback, useEffect, useState } from "react"
import { ChatWorkspace } from "./ChatWorkspace"
import {
  STORAGE_DEVICE_TOKEN,
  STORAGE_GATEWAY_TOKEN,
  STORAGE_SESSION_KEY,
  STORAGE_SETUP,
  STORAGE_URL
} from "../shared/storage-keys"
import { readStoredAuth, writeStoredAuth } from "../shared/auth-storage"

const DEFAULT_URL = import.meta.env.VITE_OPENCLAW_URL || "http://localhost:18789"
const DEFAULT_GATEWAY_TOKEN = "replace-with-long-random-secret"

function normalizeUrl(raw: string): string {
  let value = raw.trim()
  if (!value) return value
  if (!/^https?:\/\//i.test(value)) {
    value = `http://${value}`
  }
  return value
}

function isValidHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
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
    const res = await fetch(gatewayHealthUrl(base), { method: "GET", cache: "no-store" })
    return res.ok
  } catch {
    return false
  }
}

export function App() {
  const isDetachedWindow = new URLSearchParams(window.location.search).get("mode") === "window"
  const [phase, setPhase] = useState<"loading" | "setup" | "main">("loading")
  const [url, setUrl] = useState(DEFAULT_URL)
  const [tempUrl, setTempUrl] = useState(DEFAULT_URL)
  const [tempToken, setTempToken] = useState("")
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [hasDeviceToken, setHasDeviceToken] = useState(false)
  const [error, setError] = useState("")
  const [fromMain, setFromMain] = useState(false)
  const [health, setHealth] = useState<"checking" | "ok" | "fail">("checking")

  const load = useCallback(async () => {
    const data = await readStoredAuth()
    const storedUrl = typeof data[STORAGE_URL] === "string" ? data[STORAGE_URL] : ""
    const storedToken = typeof data[STORAGE_GATEWAY_TOKEN] === "string" ? data[STORAGE_GATEWAY_TOKEN] : ""
    const storedDeviceToken =
      typeof data[STORAGE_DEVICE_TOKEN] === "string" ? data[STORAGE_DEVICE_TOKEN] : ""

    const effectiveUrl = normalizeUrl(storedUrl || DEFAULT_URL)
    const effectiveToken = storedToken.trim() || DEFAULT_GATEWAY_TOKEN

    const bootstrapUpdates: Record<string, unknown> = {}
    if (!storedUrl && isValidHttpUrl(effectiveUrl)) {
      bootstrapUpdates[STORAGE_URL] = effectiveUrl
    }
    if (data[STORAGE_SETUP] === undefined) {
      bootstrapUpdates[STORAGE_SETUP] = true
    }
    if (!storedToken.trim()) {
      bootstrapUpdates[STORAGE_GATEWAY_TOKEN] = DEFAULT_GATEWAY_TOKEN
    }
    if (Object.keys(bootstrapUpdates).length > 0) {
      await writeStoredAuth(bootstrapUpdates)
    }

    setUrl(effectiveUrl)
    setTempUrl(effectiveUrl)
    setTempToken(effectiveToken)
    setShowAdvanced(storedToken.trim().length > 0 && storedToken.trim() !== DEFAULT_GATEWAY_TOKEN)
    setHasDeviceToken(storedDeviceToken.length > 0)
    setPhase(isValidHttpUrl(effectiveUrl) ? "main" : "setup")
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

  function openDetachedWindow() {
    chrome.runtime.sendMessage({ type: "OPEN_POPUP" })
  }

  function recheckHealth() {
    if (!isValidHttpUrl(url)) return
    setHealth("checking")
    void checkGatewayReachable(url).then((ok) => setHealth(ok ? "ok" : "fail"))
  }

  async function handleConnect() {
    const normalizedUrl = normalizeUrl(tempUrl)
    const token = tempToken.trim()

    if (!normalizedUrl || !isValidHttpUrl(normalizedUrl)) {
      setError("Enter a valid gateway URL, for example http://localhost:18789")
      return
    }

    const updates: Record<string, unknown> = {
      [STORAGE_URL]: normalizedUrl,
      [STORAGE_SETUP]: true
    }
    if (normalizeUrl(url) !== normalizedUrl) {
      updates[STORAGE_SESSION_KEY] = ""
    }
    updates[STORAGE_GATEWAY_TOKEN] = token || ""

    await writeStoredAuth(updates)
    setError("")
    setUrl(normalizedUrl)
    setFromMain(false)
    setPhase("main")
  }

  function openSettings() {
    setFromMain(true)
    setTempUrl(url)
    void readStoredAuth().then((data) => {
      const storedToken =
        typeof data[STORAGE_GATEWAY_TOKEN] === "string" ? data[STORAGE_GATEWAY_TOKEN] : ""
      const deviceToken =
        typeof data[STORAGE_DEVICE_TOKEN] === "string" ? data[STORAGE_DEVICE_TOKEN] : ""
      const normalizedToken = storedToken.trim() || DEFAULT_GATEWAY_TOKEN

      setTempToken(normalizedToken)
      setShowAdvanced(storedToken.trim().length > 0 && storedToken.trim() !== DEFAULT_GATEWAY_TOKEN)
      setHasDeviceToken(deviceToken.length > 0)
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
                Set the gateway URL and connect. The local demo token is filled automatically.
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

          <button
            type="button"
            className="btn-inline btn-inline--compact"
            onClick={() => setShowAdvanced((current) => !current)}
          >
            {showAdvanced ? "Hide advanced" : "Show advanced"}
          </button>

          {showAdvanced ? (
            <>
              <label className="field-label" htmlFor="oc-token" style={{ marginTop: 14 }}>
                Gateway token (optional)
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
            </>
          ) : null}

          {error ? <p className="field-error">{error}</p> : null}
          <p className="field-hint">
            {hasDeviceToken
              ? "This device was already paired with the gateway. You only need a token if auth is re-enabled later."
              : "The local demo token is already prefilled. You only need to edit it if you changed OPENCLAW_GATEWAY_TOKEN."}
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
          {!isDetachedWindow ? (
            <button
              type="button"
              className="icon-btn"
              onClick={openDetachedWindow}
              title="Open in separate window"
              aria-label="Open in separate window"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <path d="M4 8a2 2 0 0 1 2-2h8" />
                <path d="M10 4h10v10" />
                <path d="M14 4 20 4 20 10" />
                <path d="M20 4 10 14" />
                <rect x="4" y="8" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : null}
          <button
            type="button"
            className="icon-btn"
            onClick={openControlUiTab}
            title="Open the full Control UI in a tab"
            aria-label="Open the full Control UI"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14 21 3" />
            </svg>
          </button>
          <button
            type="button"
            className="icon-btn"
            onClick={openSettings}
            title="Edit gateway settings"
            aria-label="Settings"
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
                <span>Gateway reachable</span>
              ) : (
                <span>Gateway is not reachable</span>
              )}
            </div>
            <button type="button" className="btn-inline btn-inline--dim" onClick={recheckHealth}>
              Recheck
            </button>
          </div>
          <ChatWorkspace gatewayHttpBase={url} />
        </>
      ) : (
        <main className="main-hub">
          <div className="frame-fallback">
            <p>The saved gateway URL is invalid.</p>
            <button type="button" className="btn btn--primary" onClick={openSettings}>
              Set URL
            </button>
          </div>
        </main>
      )}
    </div>
  )
}
