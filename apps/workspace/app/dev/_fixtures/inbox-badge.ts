export function installInboxBadgeFake(pending: number): void {
  if (typeof window === 'undefined' || process.env.NODE_ENV !== 'development') return
  const w = window as unknown as { __inboxBadgeFake?: boolean }
  if (w.__inboxBadgeFake) return
  w.__inboxBadgeFake = true
  const real = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (new URL(url, window.location.origin).pathname === '/api/inbox/summary') return Response.json({ pending })
    return real(input, init)
  }
}
