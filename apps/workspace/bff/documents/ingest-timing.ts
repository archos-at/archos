/**
 * The job's own account, for the analytics event: time queued and time worked,
 * where the worked time went by stage, and how much of the file was read.
 */

/** The ingest stages the worker times (`ingest_measures.STAGES`), in pipeline order. */
export const INGEST_STAGES = ['text', 'tables', 'screen', 'ocr', 'renders', 'rasters', 'vision', 'summary', 'dossier', 'embedding', 'write'] as const
export type IngestStage = (typeof INGEST_STAGES)[number]

/** The reading counts the worker reports (`ingest_measures.coverage_counts`); a count it did not report is absent. */
export interface IngestReading {
  pages?: number
  pagesFullyRead?: number
  pagesNotRead?: number
  pagesOverRenderCap?: number
  rastersOverCap?: number
}

/** Milliseconds from submission to start, and from start to completion; null where the job recorded no time. */
export interface IngestTiming {
  queueWaitMs: number | null
  processingMs: number | null
  /** Seconds per stage, from the job's `metadata.stage_seconds`; only the stages the file reached. */
  stageSeconds?: Partial<Record<IngestStage, number>>
  /** From the job's `metadata.coverage`. */
  reading?: IngestReading
}

/**
 * `IngestionJobStatus.submitted_at` / `started_at` / `completed_at`: ISO strings in
 * naive UTC. Raw from the wire, so typed `unknown` and parsed by `timingOf`.
 */
export interface JobClock {
  submitted_at?: unknown
  started_at?: unknown
  completed_at?: unknown
  /** `stage_seconds` and `coverage` are read from it (`knowledge_layer/llamaindex/ingest_measures.py`). */
  metadata?: unknown
}

/**
 * A backend timestamp as epoch ms, or null. The ingestor stamps naive UTC
 * (`datetime.utcnow()`), so a string without an offset is read as UTC, not as
 * this process's local time.
 */
const backendInstant = (value: unknown): number | null => {
  if (typeof value !== 'string' || value.length === 0) return null
  const zoned = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`
  const ms = Date.parse(zoned)
  return Number.isFinite(ms) ? ms : null
}

/** The gap from `from` to `to`; null when either end is missing or unreadable, or they are out of order (a clock fault, not a zero). */
const gapMs = (from: unknown, to: unknown): number | null => {
  const start = backendInstant(from)
  const end = backendInstant(to)
  return start !== null && end !== null && end >= start ? end - start : null
}

const recordOf = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}

/** A finite, non-negative number, or undefined: a wire value is never trusted to be one. */
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
