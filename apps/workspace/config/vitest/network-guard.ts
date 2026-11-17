export const NETWORK_REFUSED_HEADER = 'x-vitest-network'

export function refuseNetwork(): void {
  const happyDOM = (globalThis as { happyDOM?: { settings: { fetch: { interceptor: unknown } } } }).happyDOM
  if (!happyDOM) return // a `@vitest-environment node` spec: no DOM, no happy-dom fetch
  const refused = { status: 503, statusText: 'Network disabled in tests', headers: { [NETWORK_REFUSED_HEADER]: 'refused' } }
  type RefusingWindow = { Response: typeof Response; Headers: typeof Headers }
  happyDOM.settings.fetch.interceptor = {
    beforeAsyncRequest: async ({ window }: { window: RefusingWindow }) => new window.Response(null, refused),
    beforeSyncRequest: ({ request, window }: { request: Request; window: RefusingWindow }) => ({
      ...refused,
      ok: false,
      redirected: false,
      url: request.url,
      headers: new window.Headers(refused.headers),
      body: null,
    }),
  }
}
