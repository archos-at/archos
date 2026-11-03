/** The job's own clock, for the analytics event: time queued and time worked. */

/** Milliseconds from submission to start, and from start to completion; null where the job recorded no time. */
export interface IngestTiming {
  queueWaitMs: number | null
  processingMs: number | null
}

/**
 * `IngestionJobStatus.submitted_at` / `started_at` / `completed_at`: ISO strings in
 * naive UTC. Raw from the wire, so typed `unknown` and parsed by `timingOf`.
 */
export interface JobClock {
  submitted_at?: unknown
  started_at?: unknown
  completed_at?: unknown
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

export const timingOf = (job: JobClock): IngestTiming => ({
  queueWaitMs: gapMs(job.submitted_at, job.started_at),
  processingMs: gapMs(job.started_at, job.completed_at),
})
