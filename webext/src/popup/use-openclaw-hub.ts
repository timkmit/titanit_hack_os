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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  const rpcWaiters = useRef(
    new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  )
  const gwListenerRef = useRef<(msg: GwEventMessage) => void>(() => {})

  useEffect(() => {
    mountedRef.current = true

    const rejectPending = (message: string) => {
      for (const [rid, waiter] of rpcWaiters.current.entries()) {
        rpcWaiters.current.delete(rid)
        waiter.reject(new Error(message))
      }
    }

    const connectPort = () => {
      if (!mountedRef.current) return
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }

      setConn("connecting")
      const port = chrome.runtime.connect({ name: "openclaw-hub" })
      portRef.current = port

      const onMsg = (msg: ConnMessage | RpcResMessage | GwEventMessage) => {
        if (msg.type === "conn") {
          if (msg.status === "ready") {
            setConn("ready")
            setConnError("")
          } else {
            setConn("error")
            setConnError(msg.detail ?? "Connection failed")
          }
          return
        }
        if (msg.type === "rpcRes") {
          const waiter = rpcWaiters.current.get(msg.rid)
          if (waiter) {
            rpcWaiters.current.delete(msg.rid)
            if (msg.ok) waiter.resolve(msg.result)
            else waiter.reject(new Error(msg.error ?? "RPC"))
          }
          return
        }
        if (msg.type === "gwEvent") {
          gwListenerRef.current(msg)
        }
      }

      const onDisconnect = () => {
        port.onMessage.removeListener(onMsg)
        portRef.current = null
        rejectPending("Port disconnected")
        if (!mountedRef.current) return
        setConn("connecting")
        setConnError("Reconnecting...")
        reconnectTimerRef.current = setTimeout(connectPort, 400)
      }

      port.onMessage.addListener(onMsg)
      port.onDisconnect.addListener(onDisconnect)
    }

    connectPort()

    return () => {
      mountedRef.current = false
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      rejectPending("Popup closed")
      portRef.current?.disconnect()
      portRef.current = null
    }
  }, [])

  const rpc = useCallback((method: string, params: Record<string, unknown> = {}) => {
    const port = portRef.current
    if (!port) return Promise.reject(new Error("No port"))
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
