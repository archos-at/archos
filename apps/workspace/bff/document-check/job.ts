import 'server-only'
import { isAuthzRefusal } from '@/lib/api/errors'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { isAgentNoticesEnabled } from '@/lib/authz/feature-flags'
import { unaskedSpendAllowed } from '@/lib/budgets/unasked-spend'
import { requireProjectAccess } from '@/lib/authz/projects'
import { listDocumentAnnotations } from '@/lib/annotations/repository'
import { listTurnChangeRows } from '@/lib/changes/repository'
import {
  deleteConversationInOrg,
  findMessageInConversation,
  insertConversation,
  insertMessages,
} from '@/lib/conversations/repository'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { documentDisplayName } from '@/lib/documents/display-name'
import type { JobAttempt, JobSliceResult, DocumentCheckPayload } from '@/lib/jobs-queue/types'
import { recordDocumentCheckScore } from '@/lib/langfuse/document-check-score'
import { askAnswerMessageId } from '@/lib/turns/answer-ids'
import { leaveNotice, noticeThread } from '@/lib/revision-notice/leave'
import { documentFocus } from '@/lib/turns/document-focus'
import { chatSocketUrl, runHeadlessTurn, type HeadlessUserMessage } from '@/lib/turns/headless-turn'
import { HEADLESS_MODE_HEADERS } from '@/lib/turns/headless-mode'
import { resolveTurnContext, TurnBudgetExhaustedError } from '@/lib/turns/turn-context'
import { turnContextHeaders } from '@/lib/turns/turn-headers.js'
import {
  checkExcerpt,
  checkInstruction,
  checkMessage,
  documentCheckConversationId,
  documentCheckMessageId,
  MAX_WAITS,
  POLL_SECONDS,
} from './check'

export const CHECK_REQUIRES = ['user_message.trigger', 'user_message.if_idle'] as const

type Result = JobSliceResult<DocumentCheckPayload>

const MAX_TITLE = 200

const later = (payload: DocumentCheckPayload): Result => ({
  done: false,
  payload,
  notBefore: new Date(Date.now() + POLL_SECONDS * 1000),
})

async function checkableDocument(session: AuthorizedSession, documentId: string): Promise<Document | null> {
  try {
    const document = await getAccessibleDocument(session, documentId, 'write')
    const checkable = document.scope === 'project' && Boolean(document.projectId) && document.lifecycle === 'active'
    return checkable ? document : null
  } catch (error) {
    if (isAuthzRefusal(error)) return null
    throw error
  }
}

async function eraseConversation(organizationId: string, conversationId: string): Promise<void> {
  try {
    await deleteConversationInOrg(conversationId, organizationId)
  } catch (error) {
    console.warn('[document-check] the check conversation could not be erased:', error)
  }
}

export function checkTurnMessage(input: {
  payload: DocumentCheckPayload
  conversationId: string
  document: Pick<Document, 'id' | 'filename' | 'displayName'>
  authorName: string | null
}): HeadlessUserMessage {
  const { payload, document } = input
  const name = documentDisplayName(document)
  return {
    type: 'user_message',
    conversation_id: input.conversationId,
    message_id: payload.checkId,
    text: checkInstruction({ id: document.id, name }),
    author_name: input.authorName,
    ...documentFocus(document),
    focus_shelf: 'project',
    trigger: { kind: 'new_document', event_id: payload.checkId, annotation_id: null },
    if_idle: true,
  }
}

async function startCheck(
  session: AuthorizedSession,
  payload: DocumentCheckPayload,
  document: Document,
  attempt: JobAttempt,
): Promise<Result> {
  const { organizationId } = session
  const done: Result = { done: true, payload }
  const conversationId = documentCheckConversationId(payload.checkId)
  const name = documentDisplayName(document)
  const instruction = checkInstruction({ id: document.id, name })
  const end = async (reason: string): Promise<Result> => {
    console.debug(`[document-check] ended without a turn: ${reason}`)
    await eraseConversation(organizationId, conversationId)
    return done
  }

  if (!(await unaskedSpendAllowed(session, document.projectId ?? null))) return end('the budget is spent')
  try {
    await requireProjectAccess(session, document.projectId as string, CHAT_PERMISSIONS)
  } catch (error) {
    if (isAuthzRefusal(error)) return done
    throw error
  }
  await insertConversation({
    id: conversationId,
    organizationId,
    createdBy: session.userId,
    title: `Abgleich: ${name}`.slice(0, MAX_TITLE),
    projectId: document.projectId ?? null,
    subjectResourceType: 'document',
    subjectResourceId: document.id,
  })
  await insertMessages([
    {
      id: payload.checkId,
      conversationId,
      role: 'user',
      authorUserId: session.userId,
      content: instruction,
      metadata: { messageType: 'user', documentCheck: { checkId: payload.checkId, documentId: document.id } },
    },
  ])

  let context: Awaited<ReturnType<typeof resolveTurnContext>>
  try {
    context = await resolveTurnContext(session, { projectId: document.projectId ?? undefined, conversationId })
  } catch (error) {
    if (error instanceof TurnBudgetExhaustedError) return end(`budget: ${error.message}`)
    if (isAuthzRefusal(error)) return end('the person may no longer chat here')
    throw error
  }
  const secret = process.env.INTERNAL_API_TOKEN
  if (!secret) throw new Error('INTERNAL_API_TOKEN is not set: a check cannot sign its turn')

  const outcome = await runHeadlessTurn({
    url: chatSocketUrl(conversationId),
    conversationId,
    projectId: context.projectId,
    headers: { ...turnContextHeaders(context, { issuedAt: Date.now(), secret }), ...HEADLESS_MODE_HEADERS },
    message: checkTurnMessage({ payload, conversationId, document, authorName: session.name }),
    requires: CHECK_REQUIRES,
  })
  switch (outcome.kind) {
    case 'started':
    case 'duplicate':
    case 'busy':
      return later({ ...payload, conversationId })
    case 'unavailable':
      if (attempt.last) return end(`no chat service: ${outcome.reason}`)
      throw new Error(`the chat socket was not reachable: ${outcome.reason}`)
    case 'refused':
      return end(`refused: ${outcome.reason}`)
    case 'rejected':
      if ((outcome.code === 'auth_expired' || outcome.code === 'conversation_mismatch') && !attempt.last) {
        throw new Error(`the chat socket refused the check: ${outcome.code}`)
      }
      return end(`rejected: ${outcome.code}`)
  }
}

async function finishCheck(
  session: AuthorizedSession,
  payload: DocumentCheckPayload,
  document: Document,
  conversationId: string,
  answer: { metadata?: unknown },
): Promise<void> {
  const { organizationId } = session
  const answerId = askAnswerMessageId(conversationId, payload.checkId)
  const rows = await listTurnChangeRows(organizationId, conversationId, answerId)
  const proposed = new Set(
    rows.filter((row) => row.objectKind === 'annotation' && row.op === 'create' && !row.undoneAt).map((row) => row.annotationId),
  )
  const meta = (answer.metadata ?? {}) as { trace_id?: unknown }
  const traceId = typeof meta.trace_id === 'string' ? meta.trace_id : null
  void recordDocumentCheckScore({ checkId: payload.checkId, traceId, findings: proposed.size })

  if (proposed.size === 0) {
    await eraseConversation(organizationId, conversationId)
    return
  }
  const marks = (await listDocumentAnnotations(organizationId, document.id))
    .filter((mark) => proposed.has(mark.id))
    .sort((a, b) => a.page - b.page || a.number - b.number)
  if (marks.length === 0) {
    await eraseConversation(organizationId, conversationId)
    return
  }
  await leaveNotice({
    session,
    newer: document,
    conversationId: await noticeThread(session, document),
    messageId: documentCheckMessageId(payload.checkId),
    content: checkMessage({ documentName: documentDisplayName(document), marks }),
    metadata: {
      ...(traceId ? { trace_id: traceId } : {}),
      documentCheck: { checkId: payload.checkId, conversationId },
    },
    marks,
    excerpt: checkExcerpt(marks),
    variant: marks.length === 1 ? 'check_one' : 'check_many',
  })
}

export async function runDocumentCheckSlice(
  organizationId: string,
  payload: DocumentCheckPayload,
  attempt: JobAttempt,
): Promise<Result> {
  const done: Result = { done: true, payload }
  const session = await resolvePinnedRequesterSession({ ...payload.actor, organizationId })
  if (!session) return done
  if (!isAgentNoticesEnabled(session)) return done
  const document = await checkableDocument(session, payload.documentId)
  if (!document) return done

  const { conversationId } = payload
  if (!conversationId) return startCheck(session, payload, document, attempt)

  const answer = await findMessageInConversation(conversationId, askAnswerMessageId(conversationId, payload.checkId))
  if (!answer) {
    if (payload.waits >= MAX_WAITS) {
      console.warn(`[document-check] gave up waiting for the turn of check ${payload.checkId}`)
      await eraseConversation(organizationId, conversationId)
      return done
    }
    return later({ ...payload, waits: payload.waits + 1 })
  }
  try {
    await finishCheck(session, payload, document, conversationId, answer)
  } catch (error) {
    if (!attempt.last) throw error
    console.error(`[document-check] gave up on check ${payload.checkId}:`, error)
  }
  return done
}
