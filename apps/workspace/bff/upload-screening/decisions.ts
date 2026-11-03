/**
 * A reviewer's decision about several held documents at once (ADR-0086): the
 * Quarantäne list's selection, allowed or deleted in one request.
 *
 * Each document is decided as if it were the only one: `allow` is
 * `releaseQuarantinedDocument`, with its own review check, folder write and
 * audit; `delete` checks that the session reviews it and that it is still
 * held, then takes the shelf's own delete, which audits it. One document's
 * refusal is its outcome, never the request's, so a stale row in the list
 * does not stop the rest. They run one after another: the set is bounded
 * (`QUARANTINE_DECISION_LIMIT`), and each is a short step.
 */

import 'server-only'
import { ApiError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getAccessibleDocument } from '@/lib/documents/access'
import { isHeldAtRest } from '@/lib/documents/document-reader'
import { deleteDocument } from '@/lib/documents/document-edits'
import { deleteSessionDocument } from '@/lib/session-documents/service'
import type {
  QuarantineDecisionOutcome,
  QuarantineDecisionResult,
  QuarantineDecisions,
} from './decisions-wire'
import { mayReviewQuarantine } from './quarantine-reviewers'
import { releaseQuarantinedDocument, settleReleaseRequests } from './review'

export async function decideQuarantinedDocuments(
  session: AuthorizedSession,
  { decision, documentIds }: QuarantineDecisions,
  request: Request
): Promise<QuarantineDecisionResult> {
  const results: QuarantineDecisionResult['results'] = []
  for (const id of documentIds) {
    const outcome = await outcomeOf(id, () =>
      decision === 'allow' ? allow(session, id, request) : remove(session, id, request)
    )
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
  const doc = await getAccessibleDocument(session, id)
  if (!(await mayReviewQuarantine(session, doc))) return 'not_found'
  if (!isHeldAtRest(doc)) return 'changed'
  if (doc.scope === 'session') await deleteSessionDocument(session, id, request)
  else await deleteDocument(session, id, request)
  await settleReleaseRequests(session.organizationId, id)
  return 'deleted'
}

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
    if (error instanceof ApiError && OUTCOME_OF_STATUS[error.status])
      return OUTCOME_OF_STATUS[error.status]
    console.warn('[quarantine] a decision about one document failed', { documentId: id, error })
    return 'failed'
  }
}
