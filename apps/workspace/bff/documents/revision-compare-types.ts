import { z } from 'zod'

export const NO_VISIBLE_CHANGE = 'keine sichtbare Änderung'

export const revisionCompareBodySchema = z.object({
  older: z.guid(),
  page: z.number().int().min(1).max(2000).default(1),
})

export interface CompareRegion {
  page: number
  x: number
  y: number
  w: number
  h: number
  label: string
}

const unit = z.number().min(0).max(1)

const compareRegionSchema = z.object({
  page: z.number().int().min(1),
  x: unit,
  y: unit,
  w: unit.refine((w) => w > 0),
  h: unit.refine((h) => h > 0),
  label: z.string().trim().min(1).max(200),
})

export interface RevisionVisualChanges {
  regions: CompareRegion[]
  summary: string[]
}

const MAX_REGIONS = 12
const MAX_SUMMARY_LINES = 8

export function parseRevisionVisualChanges(raw: unknown): RevisionVisualChanges {
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const regions = (Array.isArray(body.regions) ? body.regions : [])
    .map((item) => compareRegionSchema.safeParse(item))
    .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
    .slice(0, MAX_REGIONS)
  const summary = (Array.isArray(body.summary) ? body.summary : [])
    .flatMap((line) => (typeof line === 'string' && line.trim() ? [line.trim()] : []))
    .slice(0, MAX_SUMMARY_LINES)
  return { regions, summary: regions.length === 0 && summary.length === 0 ? [NO_VISIBLE_CHANGE] : summary }
}
