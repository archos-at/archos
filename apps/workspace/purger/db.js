// @ts-check
/**
 * Queue access for the purger (ADR-0011).
 *
 * CommonJS because the purger runs as `node purger/index.js` with no build step
 * — see the note in `./storage.js`. Checked all the same: `// @ts-check` plus
 * the shapes in `./types.d.ts` put this file under the same compiler as the
 * rest of the repo, with nothing different at runtime.
 */
/** @typedef {import('./types').Tx} Tx */
/** @typedef {import('./types').QueueEntry} QueueEntry */
/** @typedef {import('postgres').Sql} Sql */
/** @typedef {Pick<QueueEntry, 'id' | 'claim_token'>} Claim  the row a holder claimed, and the claim it took */

// Every statement below spans tenants (the queue covers all organizations),
// so each runs under the platform step-up — see workers/platform-scope.js.
const { withPlatformScope } = require('../workers/platform-scope')

// The statuses and the attempt cap are declared in TypeScript
// (`bff/db/schema/deletion-queue.ts`, `DELETION_LIFECYCLE`), which this process
// cannot import: it runs unbuilt. `deletion-lifecycle.spec.mjs` holds every
// status literal and every move in this file to that declaration.
//
// A `pending` row always has an attempt left: `markFailed` and the request
// side's release leave a row at the cap `failed`, a hold's release refunds its
// attempt, and the database refuses anything else
// (`deletion_queue_pending_has_attempts`, migration 0227). So nothing here
// looks for a `pending` row the claim below can never take.
const MAX_ATTEMPTS = 10
const STALE_CLAIM_MINUTES = 15

/**
 * Claim one due queue entry. Guards:
 * - legal holds, through `legal_hold_blocks` (migration 0093) — the one
 *   predicate the BFF's immediate deletes and the delete triggers share. For a
 *   project that is a hold on the project, on anything in it (a document, a
 *   chat, a chat's attachment), on the user who created any of those, or on
 *   the organization. The predicate used to be written out here and saw only
 *   the project and the organization, so a held document inside a deleted
 *   project was purged with it.
 * - stale 'purging' rows from a crashed purger are re-claimable after 15 min
 * - retry backoff: a previously-failed row (attempts > 0, claimed_at set by the
 *   failed claim) is only re-eligible after an exponential delay measured from
 *   its last claim: 60s * 2^min(attempts, 6) — i.e. 2m, 4m, 8m, ... capped at
 *   64m. Never-claimed rows (claimed_at IS NULL) are eligible immediately.
 * The row lock (FOR UPDATE SKIP LOCKED) serializes competing purgers and
 * purge-vs-restore races.
 *
 * The claim is a token. Every claim writes a fresh `claimed_at` (the request
 * side's `claimBinEntryNow` does too), and the entry carries it back as
 * `claim_token`, the timestamp as text so its microseconds survive. Every
 * closing write below matches it: a holder whose stale claim was taken over
 * finds another token on the row and changes nothing, whatever the status
 * reads by then. A takeover is always later than the claim it replaces (by the
 * 15 minutes, or by the backoff), so two holders never share one.
 *
 * The token is compared as `$token::text::timestamptz`. Cast straight to
 * `timestamptz`, the parameter takes that type and postgres.js sends it through
 * its date serializer, which cuts it to milliseconds: no row would ever match.
 */
/**
 * @param {Tx} tx
 * @returns {Promise<QueueEntry | null>}
 */
async function claimNext(tx) {
  const rows = await tx`
    SELECT q.* FROM deletion_queue q
    WHERE (
        (
          q.status = 'pending' AND q.purge_after <= now()
          AND (
            q.claimed_at IS NULL
            OR now() > q.claimed_at + make_interval(secs => 60 * power(2, least(q.attempts, 6)))
          )
        )
        OR (q.status = 'purging' AND q.claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES}))
      )
      AND q.attempts < ${MAX_ATTEMPTS}
      AND NOT legal_hold_blocks(q.entity_type, q.entity_id, q.organization_id)
    ORDER BY q.requested_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  `
  if (rows.length === 0) return null
  const entry = /** @type {QueueEntry} */ (/** @type {unknown} */ (rows[0]))
  const claims = /** @type {{ claim_token: string }[]} */ (
    await tx`
    UPDATE deletion_queue
    SET status = 'purging', claimed_at = now(), attempts = attempts + 1
    WHERE id = ${entry.id}
    RETURNING claimed_at::text AS claim_token
  `
  )
  return { ...entry, claim_token: claims[0]?.claim_token }
}

/**
 * Re-check legal holds for an already-claimed entry. claimNext also checks,
 * but a hold can be created between claim and purge (TOCTOU); every purger
 * MUST call this inside the purge transaction before its first destructive
 * step. Same predicate as claimNext's guard: the database function.
 */
/**
 * @param {Tx} tx
 * @param {QueueEntry} entry
 * @returns {Promise<boolean>}
 */
async function hasActiveHold(tx, entry) {
  const rows = await tx`
    SELECT legal_hold_blocks(${entry.entity_type}, ${entry.entity_id}, ${entry.organization_id}) AS held
  `
  return rows[0]?.held === true
}

/**
 * Release a claimed entry back to 'pending' because a legal hold appeared
 * after the claim. Not a failure: the attempt is refunded so held rows never
 * drift toward MAX_ATTEMPTS. claimNext skips the row while the hold is active
 * and picks it up again once the hold is released.
 */
/**
 * @param {Sql} sql
 * @param {Claim} claim
 * @returns {Promise<void>}
 */
async function releaseHeld(sql, claim) {
  await withPlatformScope(sql, (tx) => tx`
    UPDATE deletion_queue
    SET status = 'pending',
        attempts = GREATEST(attempts - 1, 0),
        last_error = 'blocked by active legal hold at purge time'
    WHERE id = ${claim.id} AND status = 'purging' AND claimed_at = ${claim.claim_token}::text::timestamptz
  `)
}

/**
 * Mark an entry done: nothing left in object storage or the database.
 *
 * Takes the purge's own transaction, so the row is `purged` exactly when the
 * purge committed. As a write of its own after the commit it could fail alone
 * (a database restart between the two), and the row of an erased entity then
 * read `failed` once its attempts were spent.
 *
 * Like every write below it moves only the row this holder claimed: after a
 * stale claim was taken over, or „Endgültig löschen" closed the row in a
 * request, a second holder's late answer must not move it.
 *
 * It also closes a row that reads `failed` under this same claim. That is a
 * final attempt that ran past the stale window and was reaped while it was
 * still working: the purge then committed, and the row of an erased entity
 * must not keep saying `failed`. A row a person retried carries a new claim.
 */
/**
 * @param {Tx} tx  the purge's transaction, already in platform scope
 * @param {Claim} claim
 * @returns {Promise<void>}
 */
async function markPurged(tx, claim) {
  await tx`
    UPDATE deletion_queue
    SET status = 'purged', purged_at = now(), last_error = NULL
    WHERE id = ${claim.id}
      AND (status = 'purging' OR status = 'failed')
      AND claimed_at = ${claim.claim_token}::text::timestamptz
  `
}

/**
 * Record a failed attempt. Back to `pending` for another pass until the attempt
 * count reaches MAX_ATTEMPTS, then `failed` so it stops consuming the queue and
 * becomes visible as something needing a human.
 */
/**
 * @param {Sql} sql
 * @param {Claim} claim
 * @param {unknown} message
 * @returns {Promise<void>}
 */
async function markFailed(sql, claim, message) {
  await withPlatformScope(sql, (tx) => tx`
    UPDATE deletion_queue
    SET status = CASE WHEN attempts >= ${MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END,
        last_error = ${String(message).slice(0, 2000)}
    WHERE id = ${claim.id} AND status = 'purging' AND claimed_at = ${claim.claim_token}::text::timestamptz
  `)
}

/**
 * Terminal failure: no retries. Used for non-transient conditions (e.g. an
 * entity_type with no registered purger) so the row cannot poison the queue
 * with pointless retry loops.
 */
/**
 * @param {Sql} sql
 * @param {Claim} claim
 * @param {unknown} message
 * @returns {Promise<void>}
 */
async function markFailedPermanent(sql, claim, message) {
  await withPlatformScope(sql, (tx) => tx`
    UPDATE deletion_queue
    SET status = 'failed',
        last_error = ${String(message).slice(0, 2000)}
    WHERE id = ${claim.id} AND status = 'purging' AND claimed_at = ${claim.claim_token}::text::timestamptz
  `)
}

/**
 * Close the rows of folders that are provably erased but do not say so.
 *
 * A folder's purge runs in the BFF over HTTP and commits there; the queue row
 * is closed afterwards, in the purger's transaction. When that transaction
 * fails on the final attempt (a database restart, a crash), the folder is gone
 * and its row ends `failed`: recorded by the catch, or reaped 15 minutes on.
 * The BFF leaves a durable mark of a finished purge, `project_folders.purged_at`
 * (set last, after every document), and the row's payload names the
 * conversations whose traces a removal still owes. Purged, with none owed, is
 * erased by every record there is, so the row is closed `purged`. This runs
 * before the reap, which fails what is left.
 *
 * What it cannot tell stays `failed`, for a person: a folder whose removal
 * owes traces. A chat is not closed here either, but it is closed: its erasure
 * leaves its `conversations` row gone, and the scheduler's trace sweep
 * (`findConversationsAwaitingTraceErasure`, `workers/maintenance-sql.js`) takes
 * a `failed` row whose chat is gone, erases the traces the purger could not,
 * stamps `payload.langfuseTracesErasedAt` and closes the row `purged`. A project's
 * rows go in the same transaction as its queue row, so it cannot be half done.
 * Returns the number closed.
 */
/**
 * @param {Sql} sql
 * @returns {Promise<number>}
 */
async function closeErased(sql) {
  const rows = /** @type {{ id: string }[]} */ (
    await withPlatformScope(sql, (tx) => tx`
    UPDATE deletion_queue q
    SET status = 'purged', purged_at = now(), last_error = NULL
    WHERE q.entity_type = 'folder'
      AND (
        q.status = 'failed'
        OR (
          q.status = 'purging'
          AND q.attempts >= ${MAX_ATTEMPTS}
          AND q.claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})
        )
      )
      AND (q.payload #> '{derivedRemoval,conversationIds,0}') IS NULL
      AND EXISTS (
        SELECT 1 FROM project_folders f
        WHERE f.id::text = q.entity_id
          AND f.organization_id = q.organization_id
          AND f.purged_at IS NOT NULL
      )
    RETURNING q.id
  `)
  )
  return rows.length
}

/**
 * Terminalize rows stranded in 'purging' by a crash on their FINAL attempt.
 * claimNext's stale-reclaim branch re-picks crashed 'purging' rows, but shares
 * the `attempts < MAX_ATTEMPTS` guard with the pending branch — so a crash
 * during the MAX_ATTEMPTS'th purge (attempts already bumped to MAX at claim
 * time) leaves the row in 'purging' forever: never re-claimed, and invisible to
 * the admin deletions list, which surfaces only 'pending'/'failed'. Mark such
 * rows 'failed' so a human sees them instead of silently orphaned external
 * state. Uses the same 15-minute stale window as claimNext, so a genuinely
 * in-progress final attempt is never prematurely failed. Existing last_error
 * (from the preceding attempts) is preserved. Returns the number reaped.
 */
/**
 * @param {Sql} sql
 * @returns {Promise<number>}
 */
async function reapStranded(sql) {
  const rows = /** @type {{ id: string }[]} */ (
    await withPlatformScope(sql, (tx) => tx`
    UPDATE deletion_queue
    SET status = 'failed',
        last_error = COALESCE(
          last_error,
          'stranded in purging after max attempts (presumed purger crash)'
        )
    WHERE status = 'purging'
      AND attempts >= ${MAX_ATTEMPTS}
      AND claimed_at < now() - make_interval(mins => ${STALE_CLAIM_MINUTES})
    RETURNING id
  `)
  )
  return rows.length
}

module.exports = {
  claimNext,
  closeErased,
  hasActiveHold,
  markFailed,
  markFailedPermanent,
  markPurged,
  reapStranded,
  releaseHeld,
  MAX_ATTEMPTS,
}
