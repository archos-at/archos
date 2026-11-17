import type { NameMatch, NameSegmentKind } from './name-screen'

export const UPLOAD_SCREENED_CODE = 'UPLOAD_SCREENED'

export interface NameStopTally {
  term: string
  count: number
}

export function exclusionsByTerm(stopped: ReadonlyArray<readonly NameMatch[]>): NameStopTally[] {
  const counts = new Map<string, number>()
  for (const matches of stopped) {
    const term = matches[0]?.term
    if (term) counts.set(term, (counts.get(term) ?? 0) + 1)
  }
  return [...counts].map(([term, count]) => ({ term, count }))
}

const SEGMENT_KINDS: ReadonlySet<string> = new Set<NameSegmentKind>(['file', 'folder'])

function isNameMatch(value: unknown): value is NameMatch {
  if (!value || typeof value !== 'object') return false
  const { term, segment, kind } = value as Record<string, unknown>
  return typeof term === 'string' && term !== '' && typeof segment === 'string' && typeof kind === 'string' && SEGMENT_KINDS.has(kind)
}

export function nameStopMatchesOf(body: unknown): NameMatch[] | null {
  if (!body || typeof body !== 'object') return null
  if ((body as { code?: unknown }).code !== UPLOAD_SCREENED_CODE) return null
  const matches = ((body as { details?: { matches?: unknown } }).details ?? {}).matches
  return Array.isArray(matches) ? matches.filter(isNameMatch) : []
}
