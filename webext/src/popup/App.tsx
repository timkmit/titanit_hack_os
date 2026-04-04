import React, { useEffect, useMemo, useState } from "react"

const STORAGE_KEY = "openclawUrl"
const DEFAULT_URL = import.meta.env.VITE_OPENCLAW_URL || "http://localhost:18789"

export function App() {
  const [url, setUrl] = useState<string>(DEFAULT_URL)
  const [temp, setTemp] = useState<string>("")

  useEffect(() => {
    ;(async () => {
      const current = await chrome.storage.sync.get(STORAGE_KEY)
      const value = typeof current[STORAGE_KEY] === "string" ? current[STORAGE_KEY] : DEFAULT_URL
      setUrl(value)
      setTemp(value)
    })()
  }, [])

  async function handleSave() {
    const normalized = temp.trim()
    await chrome.storage.sync.set({ [STORAGE_KEY]: normalized })
    setUrl(normalized)
  }

  const validUrl = useMemo(() => {
    try {
      // eslint-disable-next-line no-new
      new URL(url)
      return true
    } catch {
      return false
    }
  }, [url])

  return (
    <div className="container">
      <header className="header">
        <strong>OpenClaw</strong>
        <div className="settings">
          <input
            type="text"
            value={temp}
            onChange={(e) => setTemp(e.target.value)}
            placeholder="http://localhost:18789"
            aria-label="OpenClaw URL"
          />
          <button onClick={handleSave} title="Save URL">
            Save
          </button>
        </div>
      </header>
      <main className="main">
        {validUrl ? (
          <iframe title="OpenClaw Control UI" src={url} />
        ) : (
          <div className="error">Invalid URL</div>
        )}
      </main>
    </div>
  )
}

