const PROTOCOL = 3

export function httpBaseToWsUrl(httpBase: string): string {
  const u = new URL(httpBase)
  const proto = u.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${u.host}/`
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

export type GatewayEventHandler = (ev: { event: string; payload?: unknown }) => void

export class OpenClawWsSession {
  private ws: WebSocket | null = null
  private readonly pending = new Map<string, Pending>()
  private connectSent = false
  private _connected = false

  constructor(
    private readonly wsUrl: string,
    private readonly onGatewayEvent: GatewayEventHandler
  ) {}

  get connected(): boolean {
    return this._connected
  }

  connect(opts: { gatewayToken?: string; deviceToken?: string }): Promise<{ deviceToken?: string }> {
    if (this.ws) this.close()

    const ws = new WebSocket(this.wsUrl)
    this.ws = ws

    return new Promise((resolve, reject) => {
      let settled = false
      const timeout = setTimeout(() => {
        this.close()
        if (!settled) {
          settled = true
          reject(new Error("Gateway connection timed out"))
        }
      }, 45_000)

      const finish = (fn: () => void) => {
        if (settled) return
        settled = true
        clearTimeout(timeout)
        fn()
      }

      ws.onerror = () => {
        finish(() => reject(new Error("WebSocket error")))
      }

      ws.onclose = () => {
        this._connected = false
        if (!this.connectSent) {
          finish(() => reject(new Error("Connection closed before handshake")))
        }
      }

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(String(ev.data)) as Record<string, unknown>
          this.onFrame(msg, opts, resolve, reject, finish)
        } catch (error) {
          finish(() => reject(error instanceof Error ? error : new Error(String(error))))
        }
      }
    })
  }

  private onFrame(
    msg: Record<string, unknown>,
    opts: { gatewayToken?: string; deviceToken?: string },
    resolve: (v: { deviceToken?: string }) => void,
    reject: (e: Error) => void,
    finish: (fn: () => void) => void
  ) {
    if (msg.type === "res") {
      const id = String(msg.id)
      const waiter = this.pending.get(id)
      if (waiter) {
        this.pending.delete(id)
        if (msg.ok) {
          waiter.resolve(msg.payload)
        } else {
          const err = msg.error as { message?: string } | undefined
          waiter.reject(new Error(err?.message ?? "Gateway error"))
        }
      }
      return
    }

    if (msg.type === "event") {
      const event = String(msg.event)
      if (!this._connected && event === "connect.challenge" && !this.connectSent) {
        this.connectSent = true
        this.sendConnectRequest(opts)
          .then((hello) => {
            this._connected = true
            finish(() =>
              resolve({
                deviceToken: hello?.auth?.deviceToken
              })
            )
          })
          .catch((error) =>
            finish(() => reject(error instanceof Error ? error : new Error(String(error))))
          )
        return
      }
      this.onGatewayEvent({ event, payload: msg.payload })
    }
  }

  private sendConnectRequest(opts: {
    gatewayToken?: string
    deviceToken?: string
  }): Promise<{ auth?: { deviceToken?: string } }> {
    const ws = this.ws
    if (!ws) return Promise.reject(new Error("Socket is not open"))

    const id = crypto.randomUUID()
    const auth = opts.deviceToken
      ? { deviceToken: opts.deviceToken }
      : opts.gatewayToken
        ? { token: opts.gatewayToken }
        : {}

    const params = {
      minProtocol: PROTOCOL,
      maxProtocol: PROTOCOL,
      client: {
        id: "openclaw-control-ui",
        version: "0.1.0",
        platform: "chrome-extension",
        mode: "ui"
      },
      role: "operator",
      scopes: ["operator.read", "operator.write", "operator.admin"],
      caps: [] as string[],
      commands: [] as string[],
      permissions: {} as Record<string, boolean>,
      auth,
      locale: "ru-RU",
      userAgent: "titanit-webext/0.1.0"
    }

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        resolve: (payload) => resolve(payload as { auth?: { deviceToken?: string } }),
        reject
      })
      ws.send(JSON.stringify({ type: "req", id, method: "connect", params }))
    })
  }

  request(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const ws = this.ws
    if (!ws || !this._connected) {
      return Promise.reject(new Error("Gateway is not connected"))
    }
    const id = crypto.randomUUID()
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ type: "req", id, method, params }))
    })
  }

  close() {
    this._connected = false
    this.connectSent = false
    this.pending.clear()
    try {
      this.ws?.close()
    } catch {}
    this.ws = null
  }
}
