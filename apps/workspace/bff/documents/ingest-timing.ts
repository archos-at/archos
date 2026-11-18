export const INGEST_STAGES = ['text', 'tables', 'screen', 'ocr', 'renders', 'rasters', 'vision', 'summary', 'dossier', 'embedding', 'write'] as const
export type IngestStage = (typeof INGEST_STAGES)[number]

export interface IngestReading {
  pages?: number
  pagesFullyRead?: number
  pagesNotRead?: number
  pagesOverRenderCap?: number
  rastersOverCap?: number
}

export interface IngestTiming {
  queueWaitMs: number | null
  processingMs: number | null
  stageSeconds?: Partial<Record<IngestStage, number>>
  reading?: IngestReading
}

export interface JobClock {
  submitted_at?: unknown
  started_at?: unknown
  completed_at?: unknown
  metadata?: unknown
}

const backendInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const ms = Date.parse(zoned)
  return Number.isFinite(ms) ? ms : null
}

const gapMs = (from: unknown, to: unknown): number | null => {
  const start = backendInstant(from)
  const end = backendInstant(to)
  return start !== null && end !== null && end >= start ? end - start : null
}

const recordOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

const amount = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

const stageSecondsOf = (raw: unknown): Partial<Record<IngestStage, number>> => {
  const stages = recordOf(raw)
  return Object.fromEntries(
    INGEST_STAGES.flatMap((stage) => {
      const seconds = amount(stages[stage])
      return seconds === undefined ? [] : [[stage, seconds]]
    })
  )
}

const READING_KEYS: Record<keyof IngestReading, string> = {
  pages: 'pages',
  pagesFullyRead: 'pages_fully_read',
  pagesNotRead: 'pages_not_read',
  pagesOverRenderCap: 'pages_over_render_cap',
  rastersOverCap: 'rasters_over_cap',
}

const readingOf = (raw: unknown): IngestReading => {
  const coverage = recordOf(raw)
  return Object.fromEntries(
    Object.entries(READING_KEYS).flatMap(([field, key]) => {
      const count = amount(coverage[key])
      return count === undefined ? [] : [[field, Math.round(count)]]
    })
  )
}

export const timingOf = (job: JobClock): IngestTiming => {
  const metadata = recordOf(job.metadata)
  return {
    queueWaitMs: gapMs(job.submitted_at, job.started_at),
    processingMs: gapMs(job.started_at, job.completed_at),
    stageSeconds: stageSecondsOf(metadata.stage_seconds),
    reading: readingOf(metadata.coverage),
  }
}
