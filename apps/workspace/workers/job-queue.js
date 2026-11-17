// @ts-check
/**
 * What the plain Node processes still do to `bff_job_queue` (ADR-0079, ADR-0150).
 *
 * The BFF's jobs run on Hatchet now (`bff/jobs-queue/orchestrator.ts`); the table is
 * each job's record and saved progress, written by the BFF itself
 * (`bff/jobs-queue/repository.ts`). The claim that used to live here (the fair
 * lane order, heartbeats, release on drain, reaping) is gone with the runner
 * that ran it: Hatchet dispatches, and its concurrency is the fairness.
 *
 * What stays is the purger's step and the constants both sides share. It is
 * CommonJS because the purger is a plain Node process with no build step.
 *
 * A DEAD ROW IS A TRACE, NOT A COPY OF THE JOB. A payload holds what the job was
 * asked to do: a research report, the requester's email and permissions, storage
 * keys. Once the row is dead nothing will run it, so the payload is reduced to the
 * few identifiers a sweep still matches a job by (`KEPT_PAYLOAD_KEYS`) at the
 * moment it goes dead. The row is then deleted after the retention, and with its
 * project (`eraseProject`, the purger's step) or its organization (`eraseLane`).
 */

/** @typedef {import('../purger/types').Tx} Tx */

/**
 * What a dead row keeps of its payload: ids, never content. The sweeps find a
 * dead job by `runId` (a report's filing) and the document and project ids say
 * what it was for; everything else (the report text, the requester, storage
 * keys, file names) goes with the attempt that failed.
 */
const KEPT_PAYLOAD_KEYS = ['runId', 'projectId', 'documentId', 'taskRunId', 'wakeId', 'annotationId']

/** Wait before a failed job's second attempt; each further one doubles it. 0 retries at once. */
const DEFAULT_RETRY_BACKOFF_SECONDS = 30

/** The longest a job waits between attempts, however many it has had. */
const MAX_RETRY_BACKOFF_SECONDS = 900

/**
 * Erase every job of one project, whatever its state: the project is being
 * purged, and its jobs' payloads hold its reports, file names and storage keys.
 * Runs in the caller's transaction (the purger's, already under the platform
 * role), so it commits or rolls back with the rest of the purge. A run of a
 * deleted job finds no row and ends.
 *
 * @param {Tx} tx
 * @param {string} lane the organization id
 * @param {string} projectId
 * @returns {Promise<number>} how many rows were deleted
 */
async function eraseProject(tx, lane, projectId) {
  const rows = await tx`
    DELETE FROM bff_job_queue WHERE lane = ${lane} AND payload ->> 'projectId' = ${projectId} RETURNING job_id
  `
  return rows.length
}

/**
 * Erase every job of one organization. What an organization purge calls (none
 * exists yet; see `purger/index.js`).
 *
 * @param {Tx} tx
 * @param {string} lane the organization id
 * @returns {Promise<number>} how many jobs were deleted
 */
async function eraseLane(tx, lane) {
  const rows = await tx`DELETE FROM bff_job_queue WHERE lane = ${lane} RETURNING job_id`
  await tx`DELETE FROM bff_job_lane_turns WHERE lane = ${lane}`
  return rows.length
}

module.exports = {
  DEFAULT_RETRY_BACKOFF_SECONDS,
  KEPT_PAYLOAD_KEYS,
  MAX_RETRY_BACKOFF_SECONDS,
  eraseLane,
  eraseProject,
}
