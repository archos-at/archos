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

async function remove(
  session: AuthorizedSession,
  id: string,
  request: Request
): Promise<QuarantineDecisionOutcome> {
  const doc = await findDocumentForSession(session, id)
  if (!doc || !(await mayReviewQuarantine(session, doc))) return 'not_found'
  if (!isHeldAtRest(doc)) return 'changed'
  if (doc.scope === 'session') await deleteSessionDocument(session, id, request)
  else await deleteDocument(session, id, request)
  await settleReleaseRequests(session.organizationId, id)
  return 'deleted'
}

async function recheck(session: AuthorizedSession, id: string): Promise<QuarantineDecisionOutcome> {
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
    const noDigest = error instanceof ApiError && error.details === NO_DIGEST_DETAILS
    if (error instanceof ApiError && !noDigest && OUTCOME_OF_STATUS[error.status])
      return OUTCOME_OF_STATUS[error.status]
    console.warn('[quarantine] a decision about one document failed', { documentId: id, error })
    return 'failed'
  }
}
