export function makeWidgetTokenFetcher(scopes: string[] = [], org?: 'platform'): () => Promise<string> {
  const params = scopes.map((s) => `scope=${encodeURIComponent(s)}`)
  if (org) params.push(`org=${org}`)
  const query = params.join('&')
  const url = query ? `/api/widgets/token?${query}` : '/api/widgets/token'

  return async () => {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) {
      throw new Error(`Failed to load widget token (${res.status})`)
    }
    const data = (await res.json()) as { token?: string }
    if (!data.token) {
      throw new Error('Widget token missing from response')
    }
    return data.token
  }
}
