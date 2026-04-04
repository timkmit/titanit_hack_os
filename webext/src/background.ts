const STORAGE_KEY = "openclawUrl"
const DEFAULT_URL = import.meta.env.VITE_OPENCLAW_URL || "http://localhost:18789"

chrome.runtime.onInstalled.addListener(async () => {
  const current = await chrome.storage.sync.get(STORAGE_KEY)
  if (typeof current[STORAGE_KEY] !== "string") {
    await chrome.storage.sync.set({ [STORAGE_KEY]: DEFAULT_URL })
  }
})

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg?.type === "OPEN_POPUP") {
    const url = chrome.runtime.getURL("popup/index.html")
    chrome.windows.create({ url, type: "popup", width: 420, height: 700 })
  }
})
