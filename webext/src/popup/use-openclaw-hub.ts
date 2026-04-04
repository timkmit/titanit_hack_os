import { useCallback, useEffect, useRef, useState } from "react"

export type ConnMessage =
  | { type: "conn"; status: "ready" }
  | { type: "conn"; status: "error"; detail?: string }

export type GwEventMessage = { type: "gwEvent"; event: string; payload?: unknown }

export type RpcResMessage =
  | { type: "rpcRes"; rid: string; ok: true; result?: unknown }
  | { type: "rpcRes"; rid: string; ok: false; error?: string }

export function useOpenclawHub() {
  const [conn, setConn] = useState<"connecting" | "ready" | "error">("connecting")
  const [connError, setConnError] = useState("")
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const rpcWaiters = useRef(
    new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  )
  const gwListenerRef = useRef<(msg: GwEventMessage) => void>(() => {})

  useEffect(() => {
    const port = chrome.runtime.connect({ name: "openclaw-hub" })
    portRef.current = port

    const onMsg = (msg: ConnMessage | RpcResMessage | GwEventMessage) => {
      if (msg.type === "conn") {
        if (msg.status === "ready") {
          setConn("ready")
          setConnError("")
        } else {
          setConn("error")
          setConnError(msg.detail ?? "Ошибка подключения")
        }
        return
      }
      if (msg.type === "rpcRes") {
        const w = rpcWaiters.current.get(msg.rid)
        if (w) {
          rpcWaiters.current.delete(msg.rid)
          if (msg.ok) w.resolve(msg.result)
          else w.reject(new Error(msg.error ?? "RPC"))
        }
        return
      }
      if (msg.type === "gwEvent") {
        gwListenerRef.current(msg)
      }
    }

    port.onMessage.addListener(onMsg)
    port.onDisconnect.addListener(() => {
      setConn("error")
      setConnError("Порт отключён")
    })

    return () => {
      port.onMessage.removeListener(onMsg)
      port.disconnect()
      portRef.current = null
    }
  }, [])

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}) => {
    const port = portRef.current
    if (!port) return Promise.reject(new Error("Нет порта"))
    const rid = crypto.randomUUID()
    return new Promise<unknown>((resolve, reject) => {
      rpcWaiters.current.set(rid, { resolve, reject })
      port.postMessage({ type: "rpc", rid, method, params })
    })
  }, [])

  const resetGatewaySession = useCallback(() => {
    portRef.current?.postMessage({ type: "resetSession" })
    setConn("connecting")
  }, [])

  const setGatewayEventHandler = useCallback((fn: (msg: GwEventMessage) => void) => {
    gwListenerRef.current = fn
  }, [])

  return { conn, connError, rpc, resetGatewaySession, setGatewayEventHandler }
}
