import { OpenClawWsSession, httpBaseToWsUrl } from "./background/openclaw-session"
import {
  STORAGE_DEVICE_TOKEN,
  STORAGE_GATEWAY_TOKEN,
  STORAGE_SETUP,
  STORAGE_URL
} from "./shared/storage-keys"

const PORT_NAME = "openclaw-hub"

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.sync.set({ [STORAGE_SETUP]: false })
  }
})

chrome.runtime.onMessage.addListener((msg, _sender, _sendResponse) => {
  if (msg?.type === "OPEN_POPUP") {
    const url = chrome.runtime.getURL("src/popup/index.html")
    chrome.windows.create({ url, type: "popup", width: 420, height: 700 })
  }
})

let session: OpenClawWsSession | null = null
let sessionLock: Promise<OpenClawWsSession> | null = null
const ports = new Set<chrome.runtime.Port>()

function broadcast(msg: object) {
  for (const p of ports) {
    try {
      p.postMessage(msg)
    } catch {}
  }
}

async function readAuth(): Promise<{ httpBase: string; gatewayToken: string; deviceToken?: string }> {
  const data = await chrome.storage.sync.get([
    STORAGE_URL,
    STORAGE_GATEWAY_TOKEN,
    STORAGE_DEVICE_TOKEN
  ])
  const httpBase = typeof data[STORAGE_URL] === "string" ? data[STORAGE_URL] : ""
  const gatewayToken =
    typeof data[STORAGE_GATEWAY_TOKEN] === "string" ? data[STORAGE_GATEWAY_TOKEN] : ""
  const deviceToken =
    typeof data[STORAGE_DEVICE_TOKEN] === "string" ? data[STORAGE_DEVICE_TOKEN] : undefined
  if (!httpBase || !gatewayToken) {
    throw new Error("Укажите URL и токен шлюза в настройках расширения")
  }
  return { httpBase, gatewayToken, deviceToken }
}

async function getOrCreateSession(): Promise<OpenClawWsSession> {
  if (session?.connected) return session

  if (sessionLock) return sessionLock

  sessionLock = (async () => {
    try {
      if (session) {
        session.close()
        session = null
      }
      const { httpBase, gatewayToken, deviceToken } = await readAuth()
      const wsUrl = httpBaseToWsUrl(httpBase)
      const s = new OpenClawWsSession(wsUrl, (ev) => {
        broadcast({ type: "gwEvent", event: ev.event, payload: ev.payload })
      })
      const { deviceToken: nextDevice } = await s.connect({ gatewayToken, deviceToken })
      if (nextDevice) {
        await chrome.storage.sync.set({ [STORAGE_DEVICE_TOKEN]: nextDevice })
      }
      session = s
      return s
    } finally {
      sessionLock = null
    }
  })()

  return sessionLock
}

function invalidateSession() {
  session?.close()
  session = null
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return
  ports.add(port)

  void (async () => {
    try {
      await getOrCreateSession()
      port.postMessage({ type: "conn", status: "ready" })
    } catch (e) {
      port.postMessage({
        type: "conn",
        status: "error",
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  })()

  port.onMessage.addListener((msg: Record<string, unknown>) => {
    void (async () => {
      if (msg?.type === "rpc" && typeof msg.rid === "string" && typeof msg.method === "string") {
        try {
          const s = await getOrCreateSession()
          const result = await s.request(
            msg.method,
            (msg.params as Record<string, unknown>) ?? {}
          )
          port.postMessage({ type: "rpcRes", rid: msg.rid, ok: true, result })
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e)
          if (/соедин|connection|closed|websocket|шлюз/i.test(message)) {
            invalidateSession()
          }
          port.postMessage({ type: "rpcRes", rid: msg.rid, ok: false, error: message })
        }
      }
      if (msg?.type === "resetSession") {
        invalidateSession()
        try {
          await getOrCreateSession()
          port.postMessage({ type: "conn", status: "ready" })
        } catch (e) {
          port.postMessage({
            type: "conn",
            status: "error",
            detail: e instanceof Error ? e.message : String(e)
          })
        }
      }
    })()
  })

  port.onDisconnect.addListener(() => {
    ports.delete(port)
  })
})
