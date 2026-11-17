import { SAVED_SEARCH_NAME_MAX } from '@/lib/search/saved-search-wire'

const SEPARATOR = ', '
const ELLIPSIS = '…'

export function suggestSavedSearchName(text: string, filterValues: ReadonlyArray<string | null>): string {
  const parts: string[] = []
  for (const raw of [text, ...filterValues]) {
    const part = raw?.replace(/\s+/g, ' ').trim()
    if (part && !parts.some((seen) => seen.toLocaleLowerCase('de') === part.toLocaleLowerCase('de'))) parts.push(part)
  }
  const name = parts.join(SEPARATOR)
  if (name.length <= SAVED_SEARCH_NAME_MAX) return name
  const cut = name.slice(0, SAVED_SEARCH_NAME_MAX - ELLIPSIS.length)
  const lastBreak = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf(','))
  return `${(lastBreak > SAVED_SEARCH_NAME_MAX / 2 ? cut.slice(0, lastBreak) : cut).replace(/[,\s]+$/, '')}${ELLIPSIS}`
}
