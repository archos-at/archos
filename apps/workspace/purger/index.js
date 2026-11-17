// @ts-check
/**
 * GRID purger service.
 *
 * Dedicated container (frontend image, `node purger/index.js`) that polls the
 * deletion_queue in `app` and hard-deletes soft-deleted entities across all
 * stores after their grace period. See
 * docs/adr/0011-deletion-pipeline.md (the design was never committed).
 *
 * Environment:
 *   APP_DATABASE_URL   - `app` Postgres DSN
 *   BACKEND_URL             - aiq-api base URL (Python-side purge endpoint)
 *   FRONTEND_INTERNAL_URL   - BFF base URL (chat erasure retries, folder purges; default http://frontend:3000)
 *   INTERNAL_API_TOKEN - shared token for the internal endpoint
 *   SEAWEED_ENDPOINT / SEAWEED_ACCESS_KEY / SEAWEED_SECRET_KEY / SEAWEED_BUCKET
 *   WORKOS_API_KEY          - WorkOS API key (FGA resource cleanup)
 *   LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY
 *                           - Langfuse API, to delete an erased chat's traces
 *                             (all three, or the step is a logged no-op)
 *   PURGER_POLL_INTERVAL_MS - poll interval (default 60000)
 */

const { WorkOS } = require('@workos-inc/node')
const {
  claimNext,
  closeErased,
  markFailed,
  markFailedPermanent,
  markPurged,
  reapStranded,
  releaseHeld,
} = require('./db')
const { createSql } = require('../workers/app-database')
const { abortMultipartUploads, createS3Client, deleteStoragePrefix } = require('./storage')
const { LEGAL_HOLD_CODE, purgeProject } = require('./purge-project')
const { PERMANENT_FAILURE_CODE, purgeConversation } = require('./purge-conversation')
const { purgeFolder } = require('./purge-folder')
const { initOtelLogs } = require('../observability/otel-logs')
const { initOtelMetrics } = require('../observability/otel-metrics')
const { createConversationTraceEraser, readLangfuseConfig } = require('../workers/langfuse-traces')
const { withPlatformScope } = require('../workers/platform-scope')
const { createFailureStreak, databaseOutage, escalationTicks } = require('../workers/failure-streak')

/** @typedef {import('./types').PurgeDeps} PurgeDeps */
/** @typedef {import('postgres').Sql} Sql */
/** @typedef {import('../workers/failure-streak').FailureStreak} FailureStreak */
/** @typedef {import('../workers/failure-streak').Failure} Failure */

const purgers = {
  project: purgeProject,
  conversation: purgeConversation,
  folder: purgeFolder,
}

/**
 * A queue write that failed after the purge step (recording a failure,
 * releasing a held row). With the database unavailable the row simply stays
 * 'purging' and the stale-claim window re-offers it, so that is a WARN; any
 * other failure is an ERROR.
 *
 * @param {string} what
 * @param {unknown} error
 */
function logQueueWriteFailure(what, error) {
  const outage = databaseOutage(error)
  if (outage) console.warn(`[purger] failed to ${what} (${outage.kind}); the stale-claim window re-offers the row`)
  else console.error(`[purger] failed to ${what}:`, error)
}

/**
 * The purger's loop, over injected clients so the specs can drive a tick.
 *
 * `streak` counts the ticks the database was unavailable for
 * (`workers/failure-streak.js`): a tick whose reap or claim fails that way logs
 * a WARN and retries on the next poll, a streak of about five minutes logs one
 * ERROR, and the first good tick after logs the recovery.
 *
 * @param {{ sql: Sql, deps: PurgeDeps, streak: FailureStreak }} context
 */
function createPurger({ sql, deps, streak }) {
  async function processOne() {
    const claimed = await withPlatformScope(sql, (tx) => claimNext(tx))
    if (!claimed) return false

    const purge = /** @type {Record<string, typeof purgeProject | undefined>} */ (purgers)[
      claimed.entity_type
    ]
    if (!purge) {
      const reason = `no purger registered for entity_type '${claimed.entity_type}'`
      console.error(`[purger] ${reason} (queue row ${claimed.id}) — marking failed, no retry`)
      await markFailedPermanent(sql, claimed, reason).catch((e) => logQueueWriteFailure('record error', e))
      return true
    }

    try {
      await withPlatformScope(sql, async (tx) => {
        await purge(tx, claimed, deps)
        await markPurged(tx, claimed)
      })
      console.log(`[purger] purged ${claimed.entity_type} ${claimed.entity_id} ("${claimed.display_name}")`)
      return true
    } catch (error) {
      const failure = /** @type {import('./types').LegalHoldError | undefined} */ (
        error instanceof Error ? error : undefined
      )
      if (failure?.code === LEGAL_HOLD_CODE) {
        console.warn(
          `[purger] legal hold blocked purge of ${claimed.entity_type} ${claimed.entity_id} — releasing back to pending`,
        )
        await releaseHeld(sql, claimed).catch((e) => logQueueWriteFailure('release held row', e))
        return true
      }
      if (failure?.code === PERMANENT_FAILURE_CODE) {
        console.error(`[purger] ${failure.message} (queue row ${claimed.id}) — marking failed, no retry`)
        await markFailedPermanent(sql, claimed, failure.message).catch((e) =>
          logQueueWriteFailure('record error', e),
        )
        return true
      }
      console.error('[purger] purge failed:', error)
      await markFailed(sql, claimed, failure?.message ?? error).catch((e) => logQueueWriteFailure('record error', e))
      return false
    }
  }

  let running = false
  async function tick() {
    if (running) return
    running = true
    /** @type {Failure | undefined} */
    let outage
    try {
      const closed = await closeErased(sql).catch((e) => {
        outage = databaseOutage(e)
        if (!outage) console.error('[purger] failed to close the rows of erased folders:', e)
        return 0
      })
      if (closed > 0) console.warn(`[purger] closed ${closed} row(s) of folders already purged → 'purged'`)
      const reaped = await reapStranded(sql).catch((e) => {
        outage = outage ?? databaseOutage(e)
        if (!databaseOutage(e)) console.error('[purger] failed to reap stranded rows:', e)
        return 0
      })
      if (reaped > 0) {
        console.warn(`[purger] reaped ${reaped} row(s) stranded in 'purging' → 'failed' (see last_error)`)
      }
      while (await processOne()) {
        /* keep going */
      }
      outage = undefined
    } catch (error) {
      const claimOutage = databaseOutage(error)
      if (claimOutage) outage = claimOutage
      else console.error('[purger] tick failed, retrying on the next poll:', error)
    } finally {
      running = false
    }
    if (outage) streak.failed(outage)
    else streak.succeeded()
  }

  return { processOne, tick }
}

function main() {
  initOtelLogs()
  initOtelMetrics()

  const pollIntervalMs = parseInt(process.env.PURGER_POLL_INTERVAL_MS || '60000', 10)
  const s3 = createS3Client()
  const sharedBucket = process.env.SEAWEED_BUCKET || 'grid-documents'

  /** @type {PurgeDeps} */
  const deps = {
    backendUrl: (process.env.BACKEND_URL || 'http://aiq-api:8000').replace(/\/$/, ''),
    frontendUrl: (process.env.FRONTEND_INTERNAL_URL || 'http://frontend:3000').replace(/\/$/, ''),
    internalToken: process.env.INTERNAL_API_TOKEN || '',
    bucket: sharedBucket,
    workos: process.env.WORKOS_API_KEY ? new WorkOS(process.env.WORKOS_API_KEY) : null,
    eraseConversationTraces: createConversationTraceEraser({ env: process.env }),
    deleteStoragePrefix: (/** @type {string} */ bucket, /** @type {string} */ prefix) =>
      deleteStoragePrefix(s3, bucket, prefix),
    abortMultipartUploads: (/** @type {string} */ bucket, /** @type {string} */ prefix) =>
      abortMultipartUploads(s3, bucket, prefix),
  }

  const { tick } = createPurger({
    sql: createSql(),
    deps,
    streak: createFailureStreak({ label: '[purger] queue', escalateAfter: escalationTicks(pollIntervalMs) }),
  })

  const langfuse = readLangfuseConfig(process.env)
  console.log(
    `[purger] Langfuse trace erasure: ${langfuse.config ? 'on' : `off (missing ${langfuse.missing.join(', ')})`}`,
  )
  console.log(`[purger] started, polling every ${pollIntervalMs}ms`)
  void tick()
  setInterval(() => void tick(), pollIntervalMs)
}

if (require.main === module) {
  main()
}

module.exports = { createPurger }
