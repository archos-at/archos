export const QUALITY_RANGE_PRESETS = [7, 30, 90] as const
export type QualityRangePreset = (typeof QUALITY_RANGE_PRESETS)[number]

export const QUALITY_MAX_RANGE_DAYS = 366

export const DEFAULT_QUALITY_RANGE_DAYS: QualityRangePreset = 30

export interface QualityScope {
  from: string
  to: string
  organizationIds: string[]
  projectIds: string[]
}

const DAY_MS = 24 * 60 * 60 * 1000
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function isIsoDay(value: string | null | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && utcDay(parsed) === value
}

export function rangeDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1
}

export function presetRange(days: number, now: Date = new Date()): { from: string; to: string } {
  const to = utcDay(now)
  const from = utcDay(new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * DAY_MS))
  return { from, to }
}

export function matchingPreset(
  scope: Pick<QualityScope, 'from' | 'to'>,
  now: Date = new Date()
): QualityRangePreset | null {
  if (scope.to !== utcDay(now)) return null
  const days = rangeDays(scope.from, scope.to)
  return (QUALITY_RANGE_PRESETS as readonly number[]).includes(days)
    ? (days as QualityRangePreset)
    : null
}

function idList(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function readQualityScope(params: URLSearchParams, now: Date = new Date()): QualityScope {
  const organizationIds = idList(params.getAll('org'))
  const projectIds = idList(params.getAll('project'))
  const from = params.get('from')
  const to = params.get('to')
  if (
    isIsoDay(from) &&
    isIsoDay(to) &&
    from <= to &&
    rangeDays(from, to) <= QUALITY_MAX_RANGE_DAYS
  ) {
    return { from, to, organizationIds, projectIds }
  }
  const days = Number(params.get('days'))
  const preset = (QUALITY_RANGE_PRESETS as readonly number[]).includes(days)
    ? days
    : DEFAULT_QUALITY_RANGE_DAYS
  return { ...presetRange(preset, now), organizationIds, projectIds }
}

export type QualityScopeError = 'invalid_from' | 'invalid_to' | 'range_inverted' | 'range_too_long'

export function parseQualityScopeStrict(
  params: URLSearchParams,
  now: Date = new Date()
): { ok: true; scope: QualityScope } | { ok: false; error: QualityScopeError } {
  const organizationIds = idList(params.getAll('org'))
  const projectIds = idList(params.getAll('project'))
  const from = params.get('from')
  const to = params.get('to')
  if (from === null && to === null) {
    const days = Number(params.get('days'))
    const preset = (QUALITY_RANGE_PRESETS as readonly number[]).includes(days)
      ? days
      : DEFAULT_QUALITY_RANGE_DAYS
    return { ok: true, scope: { ...presetRange(preset, now), organizationIds, projectIds } }
  }
  if (!isIsoDay(from)) return { ok: false, error: 'invalid_from' }
  if (!isIsoDay(to)) return { ok: false, error: 'invalid_to' }
  if (from > to) return { ok: false, error: 'range_inverted' }
  if (rangeDays(from, to) > QUALITY_MAX_RANGE_DAYS) return { ok: false, error: 'range_too_long' }
  return { ok: true, scope: { from, to, organizationIds, projectIds } }
}

export function writeQualityScope(params: URLSearchParams, scope: QualityScope): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const key of ['from', 'to', 'days', 'org', 'project']) next.delete(key)
  next.set('from', scope.from)
  next.set('to', scope.to)
  for (const id of scope.organizationIds) next.append('org', id)
  for (const id of scope.projectIds) next.append('project', id)
  return next
}

export function qualityScopeQuery(scope: QualityScope): string {
  return writeQualityScope(new URLSearchParams(), scope).toString()
}

export function scopeBounds(scope: Pick<QualityScope, 'from' | 'to'>): {
  start: Date
  endExclusive: Date
} {
  const start = new Date(`${scope.from}T00:00:00Z`)
  const endExclusive = new Date(Date.parse(`${scope.to}T00:00:00Z`) + DAY_MS)
  return { start, endExclusive }
}
