export const AVATAR_IMAGE_PATTERNS = [
  { protocol: 'https', hostname: 'workoscdn.com', pathname: '/images/**' },
] as const

export function isOptimizableAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  return AVATAR_IMAGE_PATTERNS.some(
    (pattern) =>
      `${pattern.protocol}:` === parsed.protocol &&
      pattern.hostname === parsed.hostname &&
      parsed.pathname.startsWith(pattern.pathname.replace(/\*+$/, '')),
  )
}
