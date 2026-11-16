export function projectIdFromPathname(pathname: string): string | null {
  const segments = pathname.split('?')[0].split('/').filter(Boolean)
  if (segments[0] !== 'app' || segments[1] !== 'projects') return null
  return segments[2] ? decodeURIComponent(segments[2]) : null
}
