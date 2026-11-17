export const FINDINGS_VERSION = 1

export const FINDING_STATUSES = ['met', 'not_met', 'open', 'not_applicable'] as const
export type FindingStatus = (typeof FINDING_STATUSES)[number]

export const FINDING_GROUNDINGS = ['sourced', 'derived', 'open'] as const
export type FindingGrounding = (typeof FINDING_GROUNDINGS)[number]

export const LEGACY_FINDING_STATUS: Readonly<Record<string, FindingStatus>> = {
  erfuellt: 'met',
  nicht_erfuellt: 'not_met',
  offen: 'open',
  nicht_anwendbar: 'not_applicable',
}
export const LEGACY_FINDING_GROUNDING: Readonly<Record<string, FindingGrounding>> = {
  belegt: 'sourced',
  abgeleitet: 'derived',
  offen: 'open',
}

const legacy = <T extends string>(value: unknown, table: Readonly<Record<string, T>>): unknown =>
  typeof value === 'string' && Object.hasOwn(table, value) ? table[value] : value

const MAX_FINDINGS = 40
const MAX_LABEL_CHARS = 200
const MAX_VALUE_CHARS = 120
const MAX_COMMENT_CHARS = 600
const MAX_CITATIONS = 8

export interface FindingReference {
  document: string
  section?: string
  page?: number
}

export interface Finding {
  requirement: string
  value?: string
  status?: FindingStatus
  grounding: FindingGrounding
  reference?: FindingReference
  citations: number[]
  comment?: string
  area?: string
}

export interface Findings {
  v: number
  items: Finding[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max: number): string | undefined => {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : undefined
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined

const sanitizeReference = (value: unknown): FindingReference | undefined => {
  if (!isRecord(value)) return undefined
  const document = text(value.document, MAX_LABEL_CHARS)
  if (!document) return undefined
  const out: FindingReference = { document }
  const section = text(value.section, MAX_LABEL_CHARS)
  if (section) out.section = section
  if (typeof value.page === 'number' && Number.isInteger(value.page) && value.page > 0)
    out.page = value.page
  return out
}

const sanitizeFinding = (value: unknown): Finding | null => {
  if (!isRecord(value)) return null
  const requirement = text(value.requirement, MAX_LABEL_CHARS)
  const status = oneOf(legacy(value.status, LEGACY_FINDING_STATUS), FINDING_STATUSES)
  const grounding = oneOf(legacy(value.grounding, LEGACY_FINDING_GROUNDING), FINDING_GROUNDINGS)
  if (!requirement || !grounding) return null
  if (value.status !== undefined && value.status !== null && !status) return null
  const citations = Array.isArray(value.citations)
    ? value.citations
        .filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0)
        .slice(0, MAX_CITATIONS)
    : []
  const out: Finding = { requirement, grounding, citations }
  if (status) out.status = status
  const val = text(value.value, MAX_VALUE_CHARS)
  if (val) out.value = val
  const reference = sanitizeReference(value.reference)
  if (reference) out.reference = reference
  const comment = text(value.comment, MAX_COMMENT_CHARS)
  if (comment) out.comment = comment
  const area = text(value.area, MAX_LABEL_CHARS)
  if (area) out.area = area
  return out
}

export function sanitizeFindings(input: unknown): Findings | null {
  if (!isRecord(input) || !Array.isArray(input.items)) return null
  const items = input.items
    .slice(0, MAX_FINDINGS)
    .map(sanitizeFinding)
    .filter((item): item is Finding => item !== null)
  if (items.length === 0) return null
  const v = typeof input.v === 'number' && Number.isFinite(input.v) ? input.v : FINDINGS_VERSION
  return { v, items }
}

export const hasFindingStatuses = (findings: Findings): boolean =>
  findings.items.some((item) => item.status !== undefined)

export const findingCounts = (findings: Findings): Record<FindingStatus, number> => {
  const counts = { met: 0, not_met: 0, open: 0, not_applicable: 0 }
  for (const item of findings.items) if (item.status) counts[item.status] += 1
  return counts
}
