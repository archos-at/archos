export interface HistoryEntryLike {
  readonly url: string | null
}

function pathAndQuery(href: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(href, origin)
  } catch {
    return null
  }
  if (url.origin !== origin) return null
  url.searchParams.sort()
  return `${url.pathname}?${url.searchParams.toString()}`
}

export function previousEntryIs(
  entries: readonly HistoryEntryLike[],
  index: number,
  target: string,
  origin: string
): boolean {
  const previousUrl = index > 0 ? entries[index - 1]?.url : null
  if (!previousUrl) return false
  const want = pathAndQuery(target, origin)
  return want !== null && pathAndQuery(previousUrl, origin) === want
}

interface NavigationLike {
  entries(): readonly HistoryEntryLike[]
  readonly currentEntry: { readonly index: number } | null
}

function isNavigationLike(value: unknown): value is NavigationLike {
  if (typeof value !== 'object' || value === null) return false
  return typeof Reflect.get(value, 'entries') === 'function' && 'currentEntry' in value
}

export function backLandsOn(target: string): boolean {
  if (typeof window === 'undefined' || !('navigation' in window)) return false
  const navigation: unknown = Reflect.get(window, 'navigation')
  if (!isNavigationLike(navigation) || !navigation.currentEntry) return false
  return previousEntryIs(navigation.entries(), navigation.currentEntry.index, target, window.location.origin)
}
