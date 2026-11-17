export function safeReturnPathname(candidate: string | null | undefined): string | undefined {
  if (!candidate?.startsWith('/')) return undefined

  let resolved: URL
  try {
    resolved = new URL(candidate, 'https://placeholder.invalid')
  } catch {
    return undefined
  }

  if (resolved.origin !== 'https://placeholder.invalid') return undefined
  if (targetsApi(resolved.pathname)) return undefined

  return `${resolved.pathname}${resolved.search}`
}

function targetsApi(pathname: string): boolean {
  let decoded = pathname
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    // Not valid percent-encoding, so no route sees anything but these bytes.
  }
  return [pathname, decoded].some((path) => path === '/api' || path.startsWith('/api/'))
}
