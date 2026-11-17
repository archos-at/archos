import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isAgentNoticesEnabled } from '@/lib/authz/feature-flags'
import { runAgentAnnotationRequest } from '@/lib/annotations/agent'
import { listDocumentAnnotations } from '@/lib/annotations/repository'
import { unaskedSpendAllowed } from '@/lib/budgets/unasked-spend'
import type { Document } from '@/lib/db/schema/documents'
import { documentDisplayName } from '@/lib/documents/display-name'
import { SCREENED_ONLY } from '@/lib/documents/document-reader'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { changedRevisionPages, compareRevisionPage } from '@/lib/documents/revision-compare-service'
import type { JobAttempt, RevisionNoticePayload } from '@/lib/jobs-queue/types'
import { recordRevisionNoticeScore } from '@/lib/langfuse/revision-notice-score'
import {
  alreadyProposed,
  maxNoticePages,
  noticeExcerpt,
  noticeMessage,
  pagesToCompare,
  proposalsFrom,
  revisionNoticeMessageId,
  type PageComparison,
} from './notice'
import { leaveNotice, noticeThread } from './leave'

export type NoticeOutcome =
  | { status: 'skipped'; reason: string }
  | { status: 'silent'; compared: number[] }
  | { status: 'proposed'; compared: number[]; marks: number }

const skipped = (reason: string): NoticeOutcome => {
  console.debug(`[revision-notice] skipped: ${reason}`)
  return { status: 'skipped', reason }
}

const isFinal = (error: unknown): boolean =>
  error instanceof ApiError && error.status >= 400 && error.status < 500

async function comparePage(
  session: AuthorizedSession,
  payload: RevisionNoticePayload,
  page: number,
): Promise<(PageComparison & { traceId: string | null }) | null> {
  try {
    const { changes, traceId } = await compareRevisionPage(session, payload.newerId, payload.olderId, page, 'notice')
    return { page, changes, traceId }
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) return null
    throw error
  }
}

async function leave(input: {
  session: AuthorizedSession
  payload: RevisionNoticePayload
  newer: Document
  older: Document
  compared: number[]
  skippedPages: number[]
  comparisons: PageComparison[]
  traceId: string | null
}): Promise<number> {
  const { session, payload, newer, older } = input
  const olderName = documentDisplayName(older)
  const found = proposalsFrom(input.comparisons, olderName)
  if (found.length === 0) return 0
  const existing = await listDocumentAnnotations(session.organizationId, newer.id)
  const fresh = proposalsFrom(input.comparisons, olderName, existing)
  const earlier = alreadyProposed(found, existing).flatMap((mark) => (mark.id ? [{ id: mark.id }] : []))

  const conversationId = await noticeThread(session, newer)
  const messageId = revisionNoticeMessageId(payload.noticeId)
  const result =
    fresh.length > 0
      ? await runAgentAnnotationRequest(
          session,
          { id: newer.id, name: newer.filename, projectId: newer.projectId ?? null },
          { op: 'propose', proposals: fresh, answerMessageId: messageId },
          { organizationId: session.organizationId, conversationId, onBehalfOf: session.userId },
        )
      : null
  const marks = [...earlier, ...((result && 'proposed' in result ? result.proposed : undefined) ?? [])]

  const excerpt = noticeExcerpt(fresh.length > 0 ? fresh : found)
  await leaveNotice({
    session,
    newer,
    conversationId,
    messageId,
    content: noticeMessage({
      newerName: documentDisplayName(newer),
      olderName,
      compared: input.compared,
      skipped: input.skippedPages,
      proposals: found,
    }),
    metadata: {
      ...(input.traceId ? { trace_id: input.traceId } : {}),
      revisionNotice: { noticeId: payload.noticeId, olderDocumentId: older.id, pages: input.compared },
    },
    marks,
    excerpt,
    variant: marks.length === 1 ? 'one' : 'many',
    related: olderName,
  })
  return marks.length
}

export async function noticeRevision(organizationId: string, payload: RevisionNoticePayload): Promise<NoticeOutcome> {
  const session = await resolvePinnedRequesterSession({ ...payload.actor, organizationId })
  if (!session) return skipped('the person is no longer a member')
  if (!isAgentNoticesEnabled(session)) return skipped('revision-suggestions is off for the organization')

  const [newer, older] = await Promise.all([
    findDocumentInOrg(payload.newerId, organizationId, SCREENED_ONLY),
    findDocumentInOrg(payload.olderId, organizationId, SCREENED_ONLY),
  ])
  if (!newer || !older) return skipped('a document is gone or held')
  if (!(await unaskedSpendAllowed(session, newer.projectId ?? null))) return skipped('the budget is spent')

  try {
    const changed = await changedRevisionPages(session, newer.id, older.id)
    const { pages, skipped: skippedPages } = pagesToCompare(changed, maxNoticePages())
    if (pages.length === 0) return { status: 'silent', compared: [] }

    const comparisons: Array<PageComparison & { traceId: string | null }> = []
    for (const page of pages) {
      const comparison = await comparePage(session, payload, page)
      if (comparison) comparisons.push(comparison)
    }
    const compared = comparisons.map((comparison) => comparison.page)
    const traceId = comparisons.find((comparison) => comparison.traceId)?.traceId ?? null
    const marks = await leave({ session, payload, newer, older, compared, skippedPages, comparisons, traceId })
    void recordRevisionNoticeScore({
      noticeId: payload.noticeId,
      traceId,
      proposed: marks,
      pagesCompared: compared.length,
      pagesChanged: changed.pages.length,
    })
    return marks === 0 ? { status: 'silent', compared } : { status: 'proposed', compared, marks }
  } catch (error) {
    if (isFinal(error)) return skipped(`refused: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

export async function runRevisionNotice(
  organizationId: string,
  payload: RevisionNoticePayload,
  attempt: JobAttempt,
): Promise<void> {
  try {
    await noticeRevision(organizationId, payload)
  } catch (error) {
    if (!attempt.last) throw error
    console.error(`[revision-notice] gave up on notice ${payload.noticeId}:`, error)
  }
}
