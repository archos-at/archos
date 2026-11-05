/**
 * A reviewer's decision about several held documents at once (ADR-0086): the
 * Quarantäne list's selection, allowed, deleted or checked again in one request.
 *
 * Each document is decided as if it were the only one: `allow` is
 * `releaseQuarantinedDocument`, with its own review check, folder write and
 * audit; `delete` checks that the session reviews it and that it is still
 * held, then takes the shelf's own delete, which audits it; `recheck` sends it
 * through the content gate again with the rules in force now, which releases
 * nothing a match would hold (`recheck`, below). One document's
 * refusal is its outcome, never the request's, so a stale row in the list
 * does not stop the rest. They run one after another: the set is bounded
 * (`QUARANTINE_DECISION_LIMIT`), and each is a short step.
 */

import 'server-only'
import { ApiError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findDocumentForSession } from '@/lib/documents/access'
import { isHeldAtRest } from '@/lib/documents/document-reader'
import { deleteDocument } from '@/lib/documents/document-edits'
import { dispatchDocument } from '@/lib/documents/document-dispatch'
import { resolveDocumentFolderPath } from '@/lib/documents/folder-path'
import { markForRescreening } from '@/lib/documents/repository'
import { documentShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { deleteSessionDocument } from '@/lib/session-documents/service'
import type {
  QuarantineDecisionOutcome,
  QuarantineDecisionResult,
  QuarantineDecisions,
} from './decisions-wire'
import { mayReviewQuarantine } from './quarantine-reviewers'
import { NO_DIGEST_DETAILS, releaseQuarantinedDocument, settleReleaseRequests } from './review'

export async function decideQuarantinedDocuments(
  session: AuthorizedSession,
  { decision, documentIds }: QuarantineDecisions,
  request: Request
): Promise<QuarantineDecisionResult> {
  const results: QuarantineDecisionResult['results'] = []
  for (const id of documentIds) {
    const outcome = await outcomeOf(id, () => DECIDE[decision](session, id, request))
    results.push({ id, outcome })
  }
  return { results }
}

async function allow(
  session: AuthorizedSession,
  id: string,
  request: Request
): Promise<QuarantineDecisionOutcome> {
  await releaseQuarantinedDocument(session, id, request)
  return 'allowed'
}

/**
 * Delete one held document, as its reviewer. The shelf's delete alone would
 * also take a document someone allowed a moment ago: a list's selection must
 * delete only what is still held.
 */
async function remove(
  session: AuthorizedSession,
  id: string,
  request: Request
): Promise<QuarantineDecisionOutcome> {
  // As the single delete loads it: a reviewer with `project:manage` and no
  // `project:view` still finds the held row (`findDocumentForSession`).
  const doc = await findDocumentForSession(session, id)
  if (!doc || !(await mayReviewQuarantine(session, doc))) return 'not_found'
  if (!isHeldAtRest(doc)) return 'changed'
  if (doc.scope === 'session') await deleteSessionDocument(session, id, request)
  else await deleteDocument(session, id, request)
  await settleReleaseRequests(session.organizationId, id)
  return 'deleted'
}

/**
 * Read one held document again through the content gate, with the rules in
 * force now: the screen was corrected, or the office changed its list, since it
 * was held. Its reviewer's to ask, like a release, and like an upload it is
 * screened, so a match holds it again and nothing reaches a model before the
 * gate passed it. Not audited as a release: nothing was lifted.
 */
async function recheck(session: AuthorizedSession, id: string): Promise<QuarantineDecisionOutcome> {
  // As the single delete loads it: a reviewer with `project:manage` and no
  // `project:view` still finds the held row (`findDocumentForSession`).
  const doc = await findDocumentForSession(session, id)
  if (!doc || !(await mayReviewQuarantine(session, doc))) return 'not_found'
  if (!isHeldAtRest(doc) || !doc.contentHash || !doc.storageKey) return 'changed'
  if (!(await markForRescreening(doc.id, session.organizationId, doc.contentHash))) return 'changed'
  publishShelfChanged(session.organizationId, documentShelf(doc))
  await dispatchDocument({
    organizationId: session.organizationId,
    projectId: doc.projectId,
    documentId: doc.id,
    filename: doc.filename,
    storageKey: doc.storageKey,
    storageBucket: doc.storageBucket,
    collectionName: doc.collectionName,
    folderPath: await resolveDocumentFolderPath(doc, session.organizationId),
  })
  return 'rechecking'
}

const DECIDE: Record<
  QuarantineDecisions['decision'],
  (session: AuthorizedSession, id: string, request: Request) => Promise<QuarantineDecisionOutcome>
> = { allow, delete: remove, recheck }

const OUTCOME_OF_STATUS: Record<number, QuarantineDecisionOutcome> = {
  403: 'forbidden',
  404: 'not_found',
  409: 'changed',
}

async function outcomeOf(
  id: string,
  decide: () => Promise<QuarantineDecisionOutcome>
): Promise<QuarantineDecisionOutcome> {
  try {
    return await decide()
  } catch (error) {
    // A release refused for want of a digest is no one else's decision: it failed.
    const noDigest = error instanceof ApiError && error.details === NO_DIGEST_DETAILS
    if (error instanceof ApiError && !noDigest && OUTCOME_OF_STATUS[error.status])
      return OUTCOME_OF_STATUS[error.status]
    console.warn('[quarantine] a decision about one document failed', { documentId: id, error })
    return 'failed'
  }
}
