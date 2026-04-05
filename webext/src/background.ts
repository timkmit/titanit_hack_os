import { OpenClawWsSession, httpBaseToWsUrl } from "./background/openclaw-session"
import { readStoredAuth, writeStoredAuth } from "./shared/auth-storage"
import {
  STORAGE_DEVICE_TOKEN,
  STORAGE_GATEWAY_TOKEN,
  STORAGE_SETUP,
  STORAGE_URL
} from "./shared/storage-keys"

const PORT_NAME = "openclaw-hub"
const DEFAULT_GATEWAY_TOKEN = "replace-with-long-random-secret"
const APP_URL = chrome.runtime.getURL("src/popup/index.html?mode=window")
const APP_WINDOW_WIDTH = 560
const APP_WINDOW_HEIGHT = 820

let appWindowId: number | null = null
let session: OpenClawWsSession | null = null
let sessionLock: Promise<OpenClawWsSession> | null = null
const ports = new Set<chrome.runtime.Port>()

chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    await chrome.storage.sync.set({ [STORAGE_SETUP]: false })
  }
})

async function openAppWindow() {
  if (appWindowId != null) {
    try {
      await chrome.windows.update(appWindowId, { focused: true })
      const tabs = await chrome.tabs.query({ windowId: appWindowId })
      const firstTab = tabs[0]
      if (firstTab?.id != null) {
        await chrome.tabs.update(firstTab.id, { active: true })
      }
      return
    } catch {
      appWindowId = null
    }
  }

  const created = await chrome.windows.create({
    url: APP_URL,
    type: "popup",
    width: APP_WINDOW_WIDTH,
    height: APP_WINDOW_HEIGHT,
    focused: true
  })
  appWindowId = created.id ?? null
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "OPEN_POPUP") {
    void openAppWindow()
  }
})

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === appWindowId) {
    appWindowId = null
  }
})

function broadcast(msg: object) {
  for (const port of ports) {
    try {
      port.postMessage(msg)
    } catch {}
  }
}

async function readAuth(): Promise<{ httpBase: string; gatewayToken?: string; deviceToken?: string }> {
  const data = await readStoredAuth()
  const httpBase = typeof data[STORAGE_URL] === "string" ? data[STORAGE_URL] : ""
  const gatewayToken =
    typeof data[STORAGE_GATEWAY_TOKEN] === "string" ? data[STORAGE_GATEWAY_TOKEN] : ""
  const deviceToken =
    typeof data[STORAGE_DEVICE_TOKEN] === "string" ? data[STORAGE_DEVICE_TOKEN] : undefined

  if (!httpBase) {
    throw new Error("Set the gateway URL in the extension settings")
  }

  return {
    httpBase,
    gatewayToken: deviceToken ? undefined : gatewayToken || DEFAULT_GATEWAY_TOKEN,
    deviceToken
  }
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
      const nextSession = new OpenClawWsSession(wsUrl, (ev) => {
        broadcast({ type: "gwEvent", event: ev.event, payload: ev.payload })
      })
      const { deviceToken: nextDevice } = await nextSession.connect({ gatewayToken, deviceToken })

      if (nextDevice) {
        await writeStoredAuth({
          [STORAGE_DEVICE_TOKEN]: nextDevice,
          [STORAGE_SETUP]: true
        })
      }

      session = nextSession
      return nextSession
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
    } catch (error) {
      port.postMessage({
        type: "conn",
        status: "error",
        detail: error instanceof Error ? error.message : String(error)
      })
    }
  })()

  port.onMessage.addListener((msg: Record<string, unknown>) => {
    void (async () => {
      if (msg?.type === "rpc" && typeof msg.rid === "string" && typeof msg.method === "string") {
        try {
          const activeSession = await getOrCreateSession()
          const result = await activeSession.request(
            msg.method,
            (msg.params as Record<string, unknown>) ?? {}
          )
          port.postMessage({ type: "rpcRes", rid: msg.rid, ok: true, result })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          if (/connection|closed|websocket|gateway/i.test(message)) {
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
        } catch (error) {
          port.postMessage({
            type: "conn",
            status: "error",
            detail: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })()
  })

  port.onDisconnect.addListener(() => {
    ports.delete(port)
  })
})
