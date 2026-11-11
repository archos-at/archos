/**
 * The connection's health ping (`GET /api/health`), answered in the browser,
 * for the shell previews (`/dev/app-rail`, `/dev/app-shell-scopes`). The
 * previews have no backend, and an unanswered ping reads as „reconnecting“
 * after its timeout, so a shot showed the connection row or not depending on
 * how long the page took to load.
 *
 * `?presence=` picks the state: healthy by default (the row says nothing, as
 * in the product), `reconnecting` (the server does not answer) or `offline`
 * (the browser says it has no network). Call it at MODULE scope, like
 * `installInboxBadgeFake`; development and browser only, installed once.
 */
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
