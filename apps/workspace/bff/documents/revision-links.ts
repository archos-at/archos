export const REVISION_BASES = ['title_block', 'name', 'content'] as const
export type RevisionBasis = (typeof REVISION_BASES)[number]

export interface RevisionRef {
  id: string
  filename: string
}

export interface RevisionLinks {
  supersededBy: RevisionRef | null
  supersedes: RevisionRef[]
  suggestion: { of: RevisionRef; confidence: number; reason: string; basis: RevisionBasis } | null
  changeSummary: { text: string; basis: RevisionRef | 'previous' } | null
  history?: RevisionHistoryEntry[]
}

export interface RevisionHistoryEntry extends RevisionRef {
  createdAt: string | null
  changeSummary: string | null
}

export const REVISION_MAX_HISTORY = 40

export const EMPTY_REVISION_LINKS: RevisionLinks = { supersededBy: null, supersedes: [], suggestion: null, changeSummary: null }

export const REVISION_MAX_NAME_LENGTH = 255
export const REVISION_MAX_REFS = 20
export const REVISION_MAX_REASON_LENGTH = 400
export const REVISION_MAX_SUMMARY_LENGTH = 2000

export interface RevisionLinkNames {
  supersededBy: string | null
  supersedes: string[]
  suggestion: { of: string; confidence: number; reason: string; basis: RevisionBasis } | null
  change: { text: string; basis: string | null } | null
}

export interface RawRevisionLinkFields {
  superseded_by?: unknown
  supersedes?: unknown
  revision_suggestion?: unknown
  change_summary?: unknown
  change_basis?: unknown
}

const asName = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= REVISION_MAX_NAME_LENGTH ? value : null

const asText = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text.length > 0 ? text.slice(0, max) : null
}

const asConfidence = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : null

function parseSuggestion(raw: unknown): RevisionLinkNames['suggestion'] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const fields = raw as Record<string, unknown>
  const of = asName(fields.of)
  const confidence = asConfidence(fields.confidence)
  const basis = fields.basis
  if (of === null || confidence === null || (typeof basis !== 'string' || !REVISION_BASES.includes(basis as RevisionBasis))) return null
  return { of, confidence, reason: asText(fields.reason, REVISION_MAX_REASON_LENGTH) ?? '', basis: basis as RevisionBasis }
}

export function parseRevisionLinkNames(raw: RawRevisionLinkFields): RevisionLinkNames | null {
  const supersedes = Array.isArray(raw.supersedes)
    ? [...new Set(raw.supersedes.map(asName).filter((name): name is string => name !== null))].slice(
        0,
        REVISION_MAX_REFS,
      )
    : []
  const changeText = asText(raw.change_summary, REVISION_MAX_SUMMARY_LENGTH)

  const names: RevisionLinkNames = {
    supersededBy: asName(raw.superseded_by),
    supersedes,
    suggestion: parseSuggestion(raw.revision_suggestion),
    change: changeText === null ? null : { text: changeText, basis: asName(raw.change_basis) },
  }
  const empty =
    names.supersededBy === null && supersedes.length === 0 && names.suggestion === null && names.change === null
  return empty ? null : names
}

export function referencedNames(names: RevisionLinkNames, ownName: string): string[] {
  const all = [
    names.supersededBy,
    ...names.supersedes,
    names.suggestion?.of ?? null,
    names.change?.basis ?? null,
  ]
  return [...new Set(all.filter((name): name is string => name !== null && name !== ownName))]
}

export function resolveRevisionLinks(
  names: RevisionLinkNames | null,
  ownName: string,
  lookup: (filename: string) => RevisionRef | null,
): RevisionLinks | null {
  if (!names) return null
  const resolve = (filename: string | null): RevisionRef | null =>
    filename === null || filename === ownName ? null : lookup(filename)

  const supersededBy = resolve(names.supersededBy)

  const seen = new Set<string>()
  const supersedes: RevisionRef[] = []
  for (const filename of names.supersedes) {
    const ref = resolve(filename)
    if (ref && !seen.has(ref.id)) {
      seen.add(ref.id)
      supersedes.push(ref)
    }
  }

  const suggestedOf = names.suggestion ? resolve(names.suggestion.of) : null
  const suggestion =
    names.suggestion && suggestedOf
      ? { of: suggestedOf, confidence: names.suggestion.confidence, reason: names.suggestion.reason, basis: names.suggestion.basis }
      : null

  let changeSummary: RevisionLinks['changeSummary'] = null
  if (names.change) {
    const { text, basis } = names.change
    if (basis === null || basis === ownName) {
      changeSummary = { text, basis: 'previous' }
    } else {
      const ref = lookup(basis)
      if (ref) changeSummary = { text, basis: ref }
    }
  }

  if (!supersededBy && supersedes.length === 0 && !suggestion && !changeSummary) return null
  return { supersededBy, supersedes, suggestion, changeSummary }
}

export function changeSummaryAgainst(summary: RevisionLinks['changeSummary'], olderId: string): string | null {
  if (!summary || summary.basis === 'previous') return null
  return summary.basis.id === olderId ? summary.text : null
}
