// @ts-check
/**
 * Ordered, idempotent purge steps for one project.
 *
 * Concurrency guarantee (precise): the queue row is NOT held under a DB lock
 * across the purge — the claim (Phase A) commits its own transaction, and this
 * runs in a fresh `tx` that does not re-lock the row. What prevents a
 * concurrent re-claim or restore is the row's `status='purging'`, not a lock.
 * `app` rows are deleted only after every external store confirmed cleanup,
 * and the project row dies LAST so pointers stay recoverable on retry.
 *
 * Legal-hold residual window: the hold is re-checked before each external
 * destructive step, but those steps (backend HTTP, SeaweedFS, WorkOS) are outside
 * any DB transaction, so a hold committed mid-step cannot roll them back. The
 * window is bounded to a single step rather than the whole purge.
 */

const { hasActiveHold } = require('./db')
const { eraseProject } = require('../workers/job-queue')

/** @typedef {import('./types').Tx} Tx */
/** @typedef {import('./types').QueueEntry} QueueEntry */
/** @typedef {import('./types').PurgeDeps} PurgeDeps */

/** error.code used to signal "hold appeared after claim" to the caller. */
const LEGAL_HOLD_CODE = 'LEGAL_HOLD_ACTIVE'

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotFound(error) {
  return (
    typeof error === 'object' &&
    error !== null &&
    /** @type {{ status?: unknown }} */ (error).status === 404
  )
}

/**
 * Throw LEGAL_HOLD_ACTIVE if a hold now covers this entry.
 *
 * @param {Tx} tx
 * @param {QueueEntry} entry
 * @returns {Promise<void>}
 */
async function assertNoHold(tx, entry) {
  if (await hasActiveHold(tx, entry)) {
    /** @type {import('./types').LegalHoldError} */
    const error = new Error(
      `legal hold active for ${entry.entity_type} ${entry.entity_id} — aborting purge`,
    )
    error.code = LEGAL_HOLD_CODE
    throw error
  }
}

/**
 * Ask the backend to erase one Chroma collection (and the summaries, job rows
 * and checkpoints that hang off it), throwing on anything short of success.
 *
 * Extracted because the project's own collection is no longer the only one a
 * project purge has to erase: every chat inside it may hold a private
 * `s_<conversationId>` collection of its own (ADR-0047 Phase 2). The endpoint
 * takes an arbitrary collection name, so nothing about it is project-specific
 * except its name.
 *
 * The two failure shapes are both retryable and both must throw: a non-2xx, and
 * a 200 whose body says `status: "failed"` — the endpoint answers 200 when the
 * collection existed and `delete_collection` returned falsy, which is an
 * orphaned collection reported as an erasure.
 *
 * @param {PurgeDeps} deps
 * @param {typeof fetch} fetchImpl
 * @param {string | null} collectionName
 * @param {string[]} conversationIds
 * @returns {Promise<void>}
 */
async function purgeBackendCollection(deps, fetchImpl, collectionName, conversationIds) {
  const res = await fetchImpl(`${deps.backendUrl}/v1/maintenance/purge-project-resources`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-token': deps.internalToken,
    },
    body: JSON.stringify({
      collection_name: collectionName,
      conversation_ids: conversationIds,
    }),
  })
  if (!res.ok) {
    throw new Error(`backend purge failed with status ${res.status}`)
  }
  const body = typeof res.json === 'function' ? await res.json().catch(() => ({})) : {}
  if (body && body.status === 'failed') {
    throw new Error(`backend purge reported failure for collection ${collectionName}`)
  }
}

/**
 * @param {Tx} tx
 * @param {QueueEntry} entry
 * @param {PurgeDeps} deps
 * @returns {Promise<void>}
 */
async function purgeProject(tx, entry, deps) {
  const { bucket, workos, deleteStoragePrefix, abortMultipartUploads } = deps
  const fetchImpl = deps.fetchImpl || fetch
  const projectId = entry.entity_id
  const orgId = entry.organization_id

  await assertNoHold(tx, entry)

  const [project] = await tx`SELECT * FROM projects WHERE id = ${projectId}`
  const collectionName = /** @type {string | null} */ (
    project ? project.collection_name : (entry.payload && entry.payload.collectionName) || null
  )
  const conversations = /** @type {{ id: string }[]} */ (
    await tx`SELECT id FROM conversations WHERE project_id = ${projectId}`
  )

  const sessionDocuments = /** @type {{ conversation_id: string, collection_name: string | null, storage_bucket: string | null }[]} */ (
    await tx`
      SELECT DISTINCT conversation_id, collection_name, storage_bucket
        FROM documents
       WHERE scope = 'session'
         AND conversation_id IN (SELECT id FROM conversations WHERE project_id = ${projectId})`
  )

  const documentCollections = /** @type {{ collection_name: string | null }[]} */ (
    await tx`
      SELECT DISTINCT collection_name FROM documents
       WHERE project_id = ${projectId} AND collection_name IS NOT NULL`
  )

  await purgeBackendCollection(
    deps,
    fetchImpl,
    collectionName,
    conversations.map((c) => c.id),
  )

  const sessionCollections = new Set(
    sessionDocuments.map((row) => row.collection_name).filter((name) => Boolean(name)),
  )
  for (const sessionCollection of sessionCollections) {
    await assertNoHold(tx, entry)
    await purgeBackendCollection(deps, fetchImpl, sessionCollection, [])
  }

  const restrictedCollections = new Set(
    documentCollections
      .map((row) => row.collection_name)
      .filter((name) => Boolean(name) && name !== collectionName && !sessionCollections.has(name)),
  )
  for (const restrictedCollection of restrictedCollections) {
    await assertNoHold(tx, entry)
    await purgeBackendCollection(deps, fetchImpl, restrictedCollection, [])
  }

  for (const conversation of conversations) {
    await assertNoHold(tx, entry)
    await deps.eraseConversationTraces(conversation.id)
  }

  await assertNoHold(tx, entry)
  const recorded = /** @type {{ storage_bucket: string }[]} */ (
    await tx`
      SELECT DISTINCT storage_bucket FROM documents
       WHERE project_id = ${projectId} AND storage_bucket IS NOT NULL
      UNION
      SELECT staging_bucket AS storage_bucket FROM mail_imports
       WHERE project_id = ${projectId}
      UNION
      SELECT staging_bucket AS storage_bucket FROM inbound_mails
       WHERE project_id = ${projectId}
      UNION
      SELECT original_bucket AS storage_bucket FROM mail_thread_entries
       WHERE project_id = ${projectId} AND original_bucket IS NOT NULL`
  )
  const targets = new Set([bucket, ...recorded.map((row) => row.storage_bucket)])
  for (const target of targets) {
    await assertNoHold(tx, entry)
    await deleteStoragePrefix(target, `org/${orgId}/project/${projectId}/`)
    await abortMultipartUploads(target, `org/${orgId}/project/${projectId}/`)
  }

  /** @type {Map<string, Set<string>>} */
  const sessionBuckets = new Map()
  for (const row of sessionDocuments) {
    const forConversation = sessionBuckets.get(row.conversation_id) ?? new Set([bucket])
    if (row.storage_bucket) forConversation.add(row.storage_bucket)
    sessionBuckets.set(row.conversation_id, forConversation)
  }
  for (const [conversationId, buckets] of sessionBuckets) {
    for (const target of buckets) {
      await assertNoHold(tx, entry)
      await deleteStoragePrefix(target, `org/${orgId}/session/${conversationId}/`)
    }
  }

  await assertNoHold(tx, entry)
  if (workos) {
    try {
      await workos.authorization.deleteResourceByExternalId({
        organizationId: orgId,
        resourceTypeSlug: 'project',
        externalId: projectId,
        cascadeDelete: true,
      })
    } catch (error) {
      if (!isNotFound(error)) throw error
    }
  }

  await tx`DELETE FROM inbox_items WHERE resource_type = 'conversation' AND resource_id IN (SELECT id FROM conversations WHERE project_id = ${projectId})`
  await tx`DELETE FROM mention_requests WHERE resource_type = 'conversation' AND resource_id IN (SELECT id FROM conversations WHERE project_id = ${projectId})`
  await tx`DELETE FROM resource_shares WHERE resource_type = 'conversation' AND resource_id IN (SELECT id FROM conversations WHERE project_id = ${projectId})`
  await tx`DELETE FROM inbox_items WHERE resource_type = 'document' AND resource_id IN (SELECT id::text FROM documents WHERE project_id = ${projectId})`
  await tx`DELETE FROM mention_requests WHERE resource_type = 'document' AND resource_id IN (SELECT id::text FROM documents WHERE project_id = ${projectId})`
  await tx`DELETE FROM resource_shares WHERE resource_type = 'document' AND resource_id IN (SELECT id::text FROM documents WHERE project_id = ${projectId})`
  await tx`DELETE FROM resource_assignments WHERE resource_type = 'document' AND resource_id IN (SELECT id::text FROM documents WHERE project_id = ${projectId})`
  await eraseProject(tx, orgId, projectId)
  await tx`DELETE FROM conversations WHERE project_id = ${projectId}`
  await tx`DELETE FROM projects WHERE id = ${projectId}`
}

module.exports = { LEGAL_HOLD_CODE, assertNoHold, purgeProject }
