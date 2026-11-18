export function installConnectionHealthFake(): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  const w = window as unknown as { __connectionHealthFake?: boolean }
  if (w.__connectionHealthFake) return
  w.__connectionHealthFake = true
  const presence = new URLSearchParams(window.location.search).get('presence')
  if (presence === 'offline') Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => false })
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (new URL(url, window.location.origin).pathname !== '/api/health') return real(input, init)
    const healthy = presence !== 'reconnecting'
    return Response.json({ ok: healthy }, { status: healthy ? 200 : 503 })
  }
}
