type Listener = (event: unknown) => void

export class FakeXhrRequest {
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: unknown = null
  timeout = 0
  status = 0
  responseText = ''
  responseHeaders: Record<string, string> = {}
  sent = false
  aborted = false

  private readonly listeners = new Map<string, Listener[]>()
  private readonly uploadListeners = new Map<string, Listener[]>()

  readonly upload = {
    addEventListener: (type: string, listener: Listener): void => {
      this.add(this.uploadListeners, type, listener)
    },
  }

  open(method: string, url: string): void {
    this.method = method
    this.url = url
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value
  }

  addEventListener(type: string, listener: Listener): void {
    this.add(this.listeners, type, listener)
  }

  getResponseHeader(name: string): string | null {
    const key = Object.keys(this.responseHeaders).find((header) => header.toLowerCase() === name.toLowerCase())
    return key === undefined ? null : this.responseHeaders[key]!
  }

  send(body: unknown): void {
    this.body = body
    this.sent = true
  }

  abort(): void {
    this.aborted = true
    this.dispatch(this.listeners, 'abort', {})
  }

  emitProgress(loaded: number, total: number): void {
    this.dispatch(this.uploadListeners, 'progress', { lengthComputable: true, loaded, total })
  }

  respond(status: number, responseText = '', headers: Record<string, string> = {}): void {
    this.status = status
    this.responseText = responseText
    this.responseHeaders = headers
    this.dispatch(this.listeners, 'load', {})
  }

  failNetwork(): void {
    this.dispatch(this.listeners, 'error', {})
  }

  timeOut(): void {
    this.dispatch(this.listeners, 'timeout', {})
  }

  private add(map: Map<string, Listener[]>, type: string, listener: Listener): void {
    const existing = map.get(type)
    if (existing) existing.push(listener)
    else map.set(type, [listener])
  }

  private dispatch(map: Map<string, Listener[]>, type: string, event: object): void {
    for (const listener of map.get(type) ?? []) listener(event)
  }
}

export interface FakeXhrHandle {
  requests: FakeXhrRequest[]
  last(): FakeXhrRequest
  restore(): void
}

export function installFakeXhr(): FakeXhrHandle {
  const requests: FakeXhrRequest[] = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'XMLHttpRequest')

  Object.defineProperty(globalThis, 'XMLHttpRequest', {
    configurable: true,
    writable: true,
    value: function FakeXhrConstructor() {
      const request = new FakeXhrRequest()
      requests.push(request)
      return request
    } as unknown as typeof XMLHttpRequest,
  })

  return {
    requests,
    last() {
      const request = requests[requests.length - 1]
      if (!request) throw new Error('No XMLHttpRequest was opened')
      return request
    },
    restore() {
      if (original) Object.defineProperty(globalThis, 'XMLHttpRequest', original)
      else Reflect.deleteProperty(globalThis, 'XMLHttpRequest')
    },
  }
}
