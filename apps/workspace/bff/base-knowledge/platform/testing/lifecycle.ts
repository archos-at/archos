/**
 * A platform change request through its lifecycle, for the specs that need
 * released platform knowledge to read (migration 0217): proposed by its author,
 * submitted, every claim accepted by a domain expert who wrote nothing in it,
 * approved by them, then published. The one way a spec seeds an approved or
 * published request; the status trigger refuses every shortcut.
 *
 * The store and the release are imported when called, after the spec has
 * pointed `APP_DATABASE_URL` at its database.
 */

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type { Tx } from '../../store/repository'
import { MAX_PROPOSED_RECORDS, type ProposedRecord } from '../wire'

export interface LifecycleActors {
  /** Who proposes the records: never the reviewer (four eyes). */
  author: string
  /** The domain expert who accepts every claim and approves. */
  expert: string
}

/** Proposed, submitted, every claim accepted and approved as domain expert. Returns the request's id. */
export async function approvedRequest(
  request: { title: string; countryId: string; records: readonly ProposedRecord[] },
  actors: LifecycleActors,
): Promise<string> {
  const store = await import('../store')
  const id = await store.insertChangeRequest({ title: request.title, countryId: request.countryId, createdBy: actors.author })
  await store.platformTransaction(async (tx) => {
    const draft = await store.lockChangeRequest(tx, id)
    // In batches, as records-propose takes them: a pack may hold more records than one batch carries.
    for (let start = 0; start < request.records.length; start += MAX_PROPOSED_RECORDS) {
      const batch = request.records.slice(start, start + MAX_PROPOSED_RECORDS)
      await store.insertProposedRecords(tx, draft!, batch, { createdBy: actors.author, proposedBy: 'person' })
    }
    await store.setChangeRequestStatus(tx, id, 'submitted', 'submittedAt')
  })
  const view = await store.readChangeRequest(id)
  await store.platformTransaction(async (tx) => {
    const decisions = view!.revisions.flatMap((revision) =>
      revision.claims.map((claim) => ({ revisionId: revision.revisionId, claimPath: claim.path, decision: 'accepted' as const })),
    )
    await store.insertReviewDecisions(tx, id, { by: actors.expert, decisionSource: 'app' }, decisions)
    await store.insertApproval(tx, { changeRequestId: id, approver: actors.expert, role: 'domain_expert', decisionSource: 'app' })
    await store.setChangeRequestStatus(tx, id, 'approved', 'decidedAt')
  })
  return id
}

/** As {@link approvedRequest}, then published to preview and stable by the expert. */
export async function publishedRequest(
  request: { title: string; countryId: string; records: readonly ProposedRecord[] },
  actors: LifecycleActors,
): Promise<string> {
  const id = await approvedRequest(request, actors)
  const release = await import('../release')
  const actor = { by: actors.expert, decisionSource: 'app' as const }
  await release.publishChangeRequest(id, 'preview', actor)
  await release.publishChangeRequest(id, 'stable', actor)
  return id
}

/**
 * For a spec that seeds a request's rows in SQL (no proposal to parse): from
 * draft to approved the lawful way, inside the caller's transaction, with a
 * reviewer's verdict on each revision and their approval as domain expert.
 */
export async function approveSeededRequest(tx: Tx, requestId: string, revisionIds: readonly string[], reviewer: string): Promise<void> {
  await tx.execute(sql`UPDATE knowledge_change_requests SET status = 'submitted' WHERE id = ${requestId}`)
  for (const revisionId of revisionIds) {
    await tx.execute(sql`INSERT INTO knowledge_review_decisions (id, change_request_id, revision_id, claim_path, decision, reviewer, decision_source)
      VALUES (${randomUUID()}, ${requestId}, ${revisionId}, 'record', 'accepted', ${reviewer}, 'app')`)
  }
  await tx.execute(sql`INSERT INTO knowledge_approvals (id, change_request_id, approver, role, decision_source)
    VALUES (${randomUUID()}, ${requestId}, ${reviewer}, 'domain_expert', 'app')`)
  await tx.execute(sql`UPDATE knowledge_change_requests SET status = 'approved' WHERE id = ${requestId}`)
}
