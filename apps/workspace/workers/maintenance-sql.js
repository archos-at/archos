/**
 * The maintenance sweeps' SQL that spans every organization: the run-history
 * prune, the conversation trace erasure's queue reads, and the download log's
 * retention. Pure functions over a postgres.js tagged template, so they are
 * unit-testable with a fake; the client is `./app-database.js`. Called by the
 * Hatchet cron tasks of the `bff-jobs` worker (`bff/scheduling/sweeps.ts`).
 */

const PRUNE_BATCH = 1000

// These statements span every organization, so they run under the shared
// platform step-up (ADR-0041).
const { PLATFORM_ROLE, enterPlatformScope } = require('./platform-scope')

/**
 * Retention: delete task_runs older than the window, in index-friendly
 * batches (id-subselect with LIMIT so each statement locks a bounded set and
 * the created_at index does the work). Returns the total rows deleted.
 */
async function pruneOldRuns(sql, retentionDays) {
  let total = 0
  for (;;) {
    // One transaction per batch: the platform scope has to be re-entered for
    // each, and keeping them separate preserves the existing batching contract
    // (a long backlog is worked off without one long lock).
    const deleted = await sql.begin(async (tx) => {
      await enterPlatformScope(tx)
      return tx`
        DELETE FROM task_runs
        WHERE id IN (
          SELECT id FROM task_runs
          WHERE created_at < now() - make_interval(days => ${retentionDays})
          ORDER BY created_at
          LIMIT ${PRUNE_BATCH}
        )
        RETURNING id
      `
    })
    total += deleted.length
    if (deleted.length < PRUNE_BATCH) break
  }
  return total
}

/**
 * How long after a chat was erased its traces are still looked for. The BFF
 * erases a chat in the delete request and closes its queue row as 'purged';
 * this is the window in which the conversation trace sweep goes back for the traces. Past it
 * the retention sweep (`TRACE_RETENTION_DAYS`) is what removes
 * them, so it need only outlast the longest outage worth recovering from.
 */
const TRACE_ERASURE_WINDOW_DAYS = 35
/**
 * How long a chat must have been gone before its traces are looked for. A turn
 * still streaming when the chat was deleted exports spans for a little while
 * afterwards, and an erasure that ran first would be stamped done and miss them.
 */
const TRACE_ERASURE_SETTLE_MINUTES = 15

/**
 * Conversations the BFF has erased (its queue row is 'purged') whose Langfuse
 * traces have not been erased yet, oldest first. A chat the purger erased
 * itself is in here too: its traces were just erased, the repeat is a list
 * that finds nothing, and one code path is cheaper than a second one to tell
 * them apart.
 *
 * A conversation under a legal hold is not returned: the hold keeps its traces,
 * exactly as it keeps everything else (`legal_hold_blocks`, the one
 * predicate the purger and the BFF's deletes share). It becomes a candidate
 * again, inside the window, once the hold is released.
 *
 * @param {object} sql  postgres.js client (or fake) exposing `.begin`
 * @param {number} limit
 * @returns {Promise<{ id: string, entity_id: string, organization_id: string }[]>}
 */
async function findConversationsAwaitingTraceErasure(sql, limit) {
  return sql.begin(async (tx) => {
    await enterPlatformScope(tx)
    return tx`
      SELECT q.id, q.entity_id, q.organization_id
      FROM deletion_queue q
      WHERE q.entity_type = 'conversation'
        AND q.status = 'purged'
        AND q.purged_at >= now() - make_interval(days => ${TRACE_ERASURE_WINDOW_DAYS})
        AND q.purged_at <= now() - make_interval(mins => ${TRACE_ERASURE_SETTLE_MINUTES})
        AND (q.payload IS NULL OR q.payload->>'langfuseTracesErasedAt' IS NULL)
        AND NOT legal_hold_blocks(q.entity_type, q.entity_id, q.organization_id)
      ORDER BY q.purged_at
      LIMIT ${limit}
    `
  })
}

/**
 * The hold re-check made immediately before a conversation's traces are
 * deleted: a hold placed since the candidates were read still keeps them.
 *
 * @param {object} sql
 * @param {{ entity_id: string, organization_id: string }} row
 * @returns {Promise<boolean>}
 */
async function conversationIsHeld(sql, row) {
  const rows = await sql.begin(async (tx) => {
    await enterPlatformScope(tx)
    return tx`
      SELECT legal_hold_blocks('conversation', ${row.entity_id}, ${row.organization_id}) AS held
    `
  })
  return rows[0]?.held === true
}

/**
 * Record that a conversation's traces were erased, on its queue row
 * (`payload.langfuseTracesErasedAt`), so no later run repeats it. A payload
 * that is not a JSON object is replaced rather than appended to.
 *
 * @param {object} sql
 * @param {string} queueId
 * @returns {Promise<void>}
 */
async function markConversationTracesErased(sql, queueId) {
  await sql.begin(async (tx) => {
    await enterPlatformScope(tx)
    await tx`
      UPDATE deletion_queue
      SET payload = (CASE WHEN jsonb_typeof(payload) = 'object' THEN payload ELSE '{}'::jsonb END)
                    || jsonb_build_object('langfuseTracesErasedAt', now())
      WHERE id = ${queueId}
    `
  })
}

/**
 * The download log's retention (migration 0114, `lib/download-log/kinds.ts`):
 * twelve months at most, whatever anyone stored, and an organization may choose
 * a shorter time between 30 and 364 days (`organizations.settings
 * .downloadLogRetentionDays`; 365 is the default and needs no row). A stored
 * value outside 30-365, or not a whole number, counts as unset, exactly as the
 * app reads it (`retentionDaysFromSettings`), so the sweep never purges earlier
 * than the page promises.
 */
const DOWNLOAD_LOG_MAX_DAYS = 365
const DOWNLOAD_LOG_MIN_DAYS = 30
const DOWNLOAD_LOG_BATCH = 1000

/**
 * Delete download-log rows past their retention, in bounded batches: one
 * statement per batch, each in its own platform-scope transaction (the table is
 * RLS-secured and only the platform role may delete, by trigger), at most
 * `maxBatches` statements in all so a backlog drains over several runs.
 *
 * First everything older than the longest retention, for every organization
 * (`document_access_log_occurred_idx`), then, per organization with a shorter
 * setting, its own cutoff (`document_access_log_org_time_idx`).
 *
 * @param {object} sql  postgres.js client (or fake) exposing `.begin`
 * @param {{ batch?: number, maxBatches?: number }} [options]
 * @returns {Promise<{ deleted: number, capped: boolean }>} `capped` when the
 *   budget ran out with a full batch still being deleted, so more may remain.
 */
async function pruneDownloadLog(sql, { batch = DOWNLOAD_LOG_BATCH, maxBatches = 50 } = {}) {
  let deleted = 0
  let used = 0

  // One batch; true when it was full, i.e. there may be more behind it.
  const deleteBatch = async (organizationId, days) => {
    used += 1
    const rows = await sql.begin(async (tx) => {
      await enterPlatformScope(tx)
      if (organizationId === null) {
        return tx`
          DELETE FROM document_access_log
          WHERE id IN (
            SELECT id FROM document_access_log
            WHERE occurred_at < now() - make_interval(days => ${days})
            ORDER BY occurred_at
            LIMIT ${batch}
          )
          RETURNING id
        `
      }
      return tx`
        DELETE FROM document_access_log
        WHERE id IN (
          SELECT id FROM document_access_log
          WHERE organization_id = ${organizationId}
            AND occurred_at < now() - make_interval(days => ${days})
          ORDER BY occurred_at
          LIMIT ${batch}
        )
        RETURNING id
      `
    })
    deleted += rows.length
    return rows.length === batch
  }

  while (used < maxBatches && (await deleteBatch(null, DOWNLOAD_LOG_MAX_DAYS))) {
    /* keep going while batches are full */
  }
  if (used >= maxBatches) return { deleted, capped: true }

  const organizations = await sql.begin(async (tx) => {
    await enterPlatformScope(tx)
    // The CASE keeps the cast from running on a value the regex rejected: the
    // planner is free to evaluate the AND arms in either order.
    return tx`
      SELECT workos_organization_id AS organization_id,
             (settings->>'downloadLogRetentionDays')::int AS days
      FROM organizations
      WHERE CASE
        WHEN settings->>'downloadLogRetentionDays' ~ '^[0-9]{1,4}$'
          THEN (settings->>'downloadLogRetentionDays')::int BETWEEN ${DOWNLOAD_LOG_MIN_DAYS} AND ${DOWNLOAD_LOG_MAX_DAYS - 1}
        ELSE false
      END
      ORDER BY workos_organization_id
      LIMIT 10000
    `
  })
  for (const organization of organizations) {
    while (used < maxBatches && (await deleteBatch(organization.organization_id, organization.days))) {
      /* keep going while batches are full */
    }
    if (used >= maxBatches) return { deleted, capped: true }
  }
  return { deleted, capped: false }
}

module.exports = {
  pruneDownloadLog,
  DOWNLOAD_LOG_MAX_DAYS,
  DOWNLOAD_LOG_MIN_DAYS,
  pruneOldRuns,
  findConversationsAwaitingTraceErasure,
  conversationIsHeld,
  markConversationTracesErased,
  PRUNE_BATCH,
  PLATFORM_ROLE,
  TRACE_ERASURE_SETTLE_MINUTES,
  TRACE_ERASURE_WINDOW_DAYS,
}
