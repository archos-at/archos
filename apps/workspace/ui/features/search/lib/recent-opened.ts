import type { SearchHit, SearchKind } from '@/lib/search/search-wire'
import { SEARCH_KINDS } from '@/lib/search/search-wire'
import { hitHref } from './search-hrefs'

export const RECENT_OPENED_KEY = 'search.opened'
export const RECENT_OPENED_MAX = 5

export interface OpenedEntry {
  kind: SearchKind
  title: string
  projectName: string | null
  folderName: string | null
  officeShelf: boolean
  href: string
}

export function openedEntry(hit: SearchHit): OpenedEntry {
  const base = { kind: hit.kind, projectName: null, folderName: null, officeShelf: false }
  switch (hit.kind) {
    case 'document':
      return {
        ...base,
        title: hit.title ?? hit.name,
        projectName: hit.projectName,
        folderName: hit.folderName,
        officeShelf: hit.shelf === 'office_shelf',
        href: hitHref({ ...hit, passage: null }),
      }
    case 'annotation':
      return { ...base, title: hit.documentName, projectName: hit.projectName, officeShelf: hit.shelf === 'office_shelf', href: hitHref(hit) }
    case 'folder':
      return { ...base, title: hit.name, projectName: hit.projectName, officeShelf: hit.shelf === 'office_shelf', href: hitHref(hit) }
    case 'project':
      return { ...base, title: hit.name, href: hitHref(hit) }
    case 'conversation':
      return { ...base, title: hit.title, projectName: hit.projectName, href: hitHref(hit) }
  }
}

export function withOpened(list: readonly OpenedEntry[], entry: OpenedEntry): OpenedEntry[] {
  return [entry, ...list.filter((other) => other.href !== entry.href)].slice(0, RECENT_OPENED_MAX)
}

function isEntry(value: unknown): value is OpenedEntry {
  if (value === null || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  const text = (field: unknown): boolean => field === null || typeof field === 'string'
  return (
    SEARCH_KINDS.some((kind) => kind === entry.kind) &&
    typeof entry.title === 'string' &&
    typeof entry.href === 'string' &&
    entry.href.startsWith('/app/') &&
    text(entry.projectName) &&
    text(entry.folderName) &&
    typeof entry.officeShelf === 'boolean'
  )
}

export function readRecentOpened(): OpenedEntry[] {
  try {
    const raw = window.localStorage.getItem(RECENT_OPENED_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, RECENT_OPENED_MAX) : []
  } catch {
    return []
  }
}

export function rememberOpened(hit: SearchHit): OpenedEntry[] {
  const next = withOpened(readRecentOpened(), openedEntry(hit))
  try {
    window.localStorage.setItem(RECENT_OPENED_KEY, JSON.stringify(next))
  } catch {
    // Storage blocked or full: the hit still opens, it is just not remembered.
  }
  return next
}
