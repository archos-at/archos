/**
 * How many attempts a job gets (`BFF_JOBS_MAX_ATTEMPTS`, default 3).
 *
 * One reader for both sides of the question: a `bff-job` run marks a job dead
 * after this many (`./task-run.ts`), and a handler is told when the attempt
 * it is running is the last one, so it can leave the truth behind before the
 * job gives up: a document that will never be extracted should say so, not
 * read "processing" until somebody notices.
 */

const DEFAULT_MAX_ATTEMPTS = 3

export function maxAttempts(env: Record<string, string | undefined> = process.env): number {
  const parsed = Number.parseInt(env.BFF_JOBS_MAX_ATTEMPTS ?? '', 10)
  return Number.isFinite(parsed) && parsed >= 1 ? parsed : DEFAULT_MAX_ATTEMPTS
}

/** True when `attempts` (spent so far, this one included) is the last claim the job gets. */
export function isLastAttempt(attempts: number, env: Record<string, string | undefined> = process.env): boolean {
  return attempts >= maxAttempts(env)
}
