/** The job's own clock, for the analytics event: time queued and time worked. */

/** Milliseconds from submission to start, and from start to completion; null where the job recorded no time. */
export interface IngestTiming {
  queueWaitMs: number | null
  processingMs: number | null
}

/** `IngestionJobStatus.submitted_at` / `started_at` / `completed_at`, ISO timestamps. */
export interface JobClock {
  submitted_at?: string | null
  started_at?: string | null
  completed_at?: string | null
}

const gapMs = (from: string | null | undefined, to: string | null | undefined): number | null => {
  if (!from || !to) return null
  const ms = new Date(to).getTime() - new Date(from).getTime()
  return Number.isFinite(ms) ? Math.max(0, ms) : null
}

export const timingOf = (job: JobClock): IngestTiming => ({
  queueWaitMs: gapMs(job.submitted_at, job.started_at),
  processingMs: gapMs(job.started_at, job.completed_at),
})
