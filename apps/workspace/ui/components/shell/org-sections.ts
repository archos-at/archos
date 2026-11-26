export function projectIdFromPathname(pathname: string): string | null {
  const segments = pathname.split('?')[0].split('/').filter(Boolean)
  if (segments[0] !== 'app' || segments[1] !== 'projects') return null
  if (!segments[2]) return null
  try {
    return decodeURIComponent(segments[2])
  } catch {
    return null
  }
}
