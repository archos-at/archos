// @ts-check
/**
 * The purge of a folder from the Papierkorb (`entity_type = 'folder'`), once
 * its grace period (`FOLDER_PURGE_GRACE_DAYS`) is over.
 *
 * Like a chat's erasure, the steps live in the BFF (`purgeBinnedFolder`,
 * `bff/projects/folder-bin.ts`): each document goes by the document
 * delete's own steps (chunks, every version's objects, renditions, thumbnails,
 * grants, the row), what was derived from the folder is marked, and removed
 * when the organization's setting asks („Mit dem Ordner entfernen“), and the folders are
 * marked purged last, leaving tombstones with their grants. A JavaScript copy
 * here would be a second deletion path to keep in step. So the purger
 * contributes the claim, the backoff, the legal-hold guard and `failed` after
 * MAX_ATTEMPTS, and asks: `POST /api/internal/folders/<id>/purge`.
 *
 * What it adds is the store the BFF never reaches: the Langfuse traces of the
 * conversations whose derived content was removed. Only this pod and the
 * scheduler hold Langfuse's keys and may reach it, so „Endgültig löschen",
 * which purges in the BFF's request, hands its row here when traces are owed;
 * the BFF then answers `already-purged` with those conversations. Then it
 * merges the counts into the queue row's payload, the record of the purge.
 */

const { LEGAL_HOLD_CODE, assertNoHold } = require('./purge-project')
const { PERMANENT_FAILURE_CODE } = require('./purge-conversation')

/** @typedef {import('./types').Tx} Tx */
/** @typedef {import('./types').QueueEntry} QueueEntry */
/** @typedef {import('./types').PurgeDeps} PurgeDeps */

const INTERNAL_TOKEN_HEADER = 'x-internal-token'

const PURGE_TIMEOUT_MS = 10 * 60_000

/**
 * @param {Tx} tx
 * @param {QueueEntry} entry
 * @param {PurgeDeps} deps
 * @returns {Promise<void>}
 */
async function purgeFolder(tx, entry, deps) {
  const fetchImpl = deps.fetchImpl || fetch

  await assertNoHold(tx, entry)

  const res = await fetchImpl(
    `${deps.frontendUrl}/api/internal/folders/${encodeURIComponent(entry.entity_id)}/purge`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_TOKEN_HEADER]: deps.internalToken,
      },
      body: JSON.stringify({ organizationId: entry.organization_id }),
      signal: AbortSignal.timeout(PURGE_TIMEOUT_MS),
    },
  )
  /** @type {{ error?: unknown, details?: { reason?: unknown }, counts?: Record<string, unknown>, traceConversationIds?: unknown } | null} */
  const body = typeof res.json === 'function' ? await res.json().catch(() => null) : null

  if (res.ok) {
    const conversations = Array.isArray(body?.traceConversationIds)
      ? body.traceConversationIds.filter((id) => typeof id === 'string')
      : []
    let traces = 0
    for (const conversationId of conversations) {
      const result = /** @type {{ traces?: number } | undefined} */ (await deps.eraseConversationTraces(conversationId))
      traces += Number(result?.traces ?? 0)
    }
    const counts = { ...(body?.counts ?? {}), tracesErased: traces }
    await tx`
      UPDATE deletion_queue
      SET payload = coalesce(payload, '{}'::jsonb) || ${JSON.stringify({ purged: counts })}::jsonb
      WHERE id = ${entry.id}
    `
    return
  }

  if (res.status === 409 && body?.details?.reason === 'legal_hold') {
    /** @type {import('./types').LegalHoldError} */
    const error = new Error(`legal hold active for folder ${entry.entity_id} — purge deferred`)
    error.code = LEGAL_HOLD_CODE
    throw error
  }
  if (res.status === 409 && body?.details?.reason === 'not_in_bin') {
    /** @type {import('./types').LegalHoldError} */
    const error = new Error(`folder ${entry.entity_id} is not in the bin — nothing was purged`)
    error.code = PERMANENT_FAILURE_CODE
    throw error
  }
  const detail = typeof body?.error === 'string' ? `: ${body.error}` : ''
  throw new Error(`folder purge answered ${res.status}${detail}`)
}

module.exports = { purgeFolder }
