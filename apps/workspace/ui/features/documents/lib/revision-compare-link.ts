export const COMPARE_PARAM = 'compare'

export function compareRevisionHref(href: string | null, olderId: string): string | null {
  if (!href) return null
  const hashAt = href.indexOf('#')
  const hash = hashAt === -1 ? '' : href.slice(hashAt)
  const withoutHash = hashAt === -1 ? href : href.slice(0, hashAt)
  const queryAt = withoutHash.indexOf('?')
  const path = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt)
  const params = new URLSearchParams(queryAt === -1 ? '' : withoutHash.slice(queryAt + 1))
  params.set(COMPARE_PARAM, olderId)
  return `${path}?${params.toString()}${hash}`
}
