import 'server-only'
import { ApiError, isAuthzRefusal } from '@/lib/api/errors'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { insertMessages } from '@/lib/conversations/repository'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import type { JobAttempt, JobSliceResult, AgentWakePayload } from '@/lib/jobs-queue/types'
import { publishToDocumentRoom } from '@/lib/realtime/document-channel'
import { documentFocus } from '@/lib/turns/document-focus'
import { chatSocketUrl, runHeadlessTurn, type HeadlessUserMessage } from '@/lib/turns/headless-turn'
import { HEADLESS_MODE_HEADERS } from '@/lib/turns/headless-mode'
import { resolveTurnContext, TurnBudgetExhaustedError } from '@/lib/turns/turn-context'
import { turnContextHeaders } from '@/lib/turns/turn-headers.js'
import { onWakeEnded } from './attention'
import { ensureDocumentThread } from './document-thread'
import { findDocumentAnnotation, type AnnotationRecord } from './repository'
import { regionAround } from './types'
import { auditSuppressedWake, capReached, wakesEnabled } from './wake'
import { auditWakeEnded, auditWakeStarted, type AuditedWake } from './wake-audit'
import { delegationEventId } from './wake-ids'
import { announceAgentWork } from './agent-work'
import { findWake, handBackDelegation, settleWake } from './wake-repository'
import { PRODUCT_NAME } from '@/lib/brand'

export const WAKE_REQUIRES = [
  'user_message.trigger',
  'user_message.if_idle',
  'user_message.focus_region',
  'user_message.reply_in_thread',
] as const

export const MAX_WAKE_WAITS = 12
const FIRST_WAIT_MS = 15_000
const LONGEST_WAIT_MS = 5 * 60_000

export const waitAfter = (waits: number): number => Math.min(FIRST_WAIT_MS * 2 ** waits, LONGEST_WAIT_MS)

type Result = JobSliceResult<AgentWakePayload>

function questionOf(payload: AgentWakePayload, mark: AnnotationRecord): string | null {
  if (payload.trigger === 'assigned') return mark.body
  return mark.replies.find((reply) => reply.id === payload.eventId)?.body ?? null
}

function triggerLine(payload: AgentWakePayload, mark: AnnotationRecord, who: string, text: string): string {
  if (payload.trigger === 'assigned') return `${who} hat Anmerkung ${mark.number} an ${PRODUCT_NAME} delegiert: „${text}“`
  return `${who} in Anmerkung ${mark.number}: „${text}“`
}

export function wakeMessage(input: {
  payload: AgentWakePayload
  conversationId: string
  doc: Pick<Document, 'id' | 'scope' | 'filename' | 'displayName'>
  mark: Pick<AnnotationRecord, 'id' | 'page' | 'x' | 'y' | 'w' | 'h'>
  text: string
  authorName: string | null
}): HeadlessUserMessage {
  const { payload, doc, mark } = input
  return {
    type: 'user_message',
    conversation_id: input.conversationId,
    message_id: payload.wakeId,
    text: input.text,
    author_name: input.authorName,
    ...documentFocus(doc),
    focus_shelf: doc.scope === 'office_shelf' ? 'office_shelf' : 'project',
    focus_region: { ...regionAround(mark), annotation_id: mark.id },
    reply_in_thread: true,
    trigger: { kind: payload.trigger, event_id: payload.eventId, annotation_id: payload.annotationId },
    if_idle: true,
    reasoning_effort: 'low',
  }
}

async function recordTrigger(
  conversationId: string,
  payload: AgentWakePayload,
  mark: AnnotationRecord,
  who: string,
  text: string
): Promise<void> {
  await insertMessages([
    {
      id: payload.wakeId,
      conversationId,
      role: 'user',
      authorUserId: payload.actor.userId,
      content: triggerLine(payload, mark, who, text),
      metadata: {
        messageType: 'user',
        trigger: {
          kind: payload.trigger,
          eventId: payload.eventId,
          annotationId: payload.annotationId,
          annotationNumber: mark.number,
          documentId: payload.documentId,
        },
      },
    },
  ])
}

const auditedWake = (
  organizationId: string,
  payload: AgentWakePayload,
  doc: Document,
  mark: AnnotationRecord
): AuditedWake => ({
  organizationId,
  wakeId: payload.wakeId,
  documentId: doc.id,
  annotationId: mark.id,
  trigger: payload.trigger,
  wokenBy: payload.actor,
  projectId: doc.projectId ?? null,
  markNumber: mark.number,
})

async function handBack(organizationId: string, payload: AgentWakePayload, doc: Document, mark: AnnotationRecord) {
  const delegatedAt = mark.delegatedAt ? new Date(mark.delegatedAt) : null
  const ownsDelegation =
    payload.trigger === 'assigned' && delegatedAt !== null && delegationEventId(mark.id, delegatedAt) === payload.eventId
  if (!ownsDelegation || !delegatedAt) return false
  try {
    const handedBack = await withTenant({ organizationId }, () =>
      handBackDelegation(getDb(), organizationId, mark.id, delegatedAt)
    )
    if (handedBack) {
      await publishToDocumentRoom(doc.id, {
        kind: 'annotations.changed',
        annotationIds: [mark.id],
        change: 'updated',
        actor: { peerId: null, userId: payload.actor.userId, name: PRODUCT_NAME, kind: 'piloti' },
      }).catch(() => undefined)
    }
    return handedBack
  } catch (error) {
    console.error('[wake-job] the mark could not be handed back after the wake ended:', error)
    return false
  }
}

async function afterEndWithoutAnswer(input: {
  organizationId: string
  payload: AgentWakePayload
  doc: Document
  mark: AnnotationRecord
  status: 'refused' | 'failed'
  reason: string
}): Promise<void> {
  const { organizationId, payload, doc, mark, status, reason } = input
  const handedBack = await handBack(organizationId, payload, doc, mark)
  auditWakeEnded(auditedWake(organizationId, payload, doc, mark), {
    outcome: status,
    turnOutcome: null,
    reason,
    handedBack,
  })
  await onWakeEnded({
    organizationId,
    documentId: doc.id,
    annotationId: mark.id,
    annotationNumber: mark.number,
    projectId: doc.projectId ?? null,
    actorUserId: payload.actor.userId,
    trigger: payload.trigger,
    outcome: 'failed',
    reason,
    markText: mark.body,
  })
}

async function writableDocument(session: AuthorizedSession, documentId: string): Promise<Document | null> {
  try {
    return await getAccessibleDocument(session, documentId, 'write')
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) return null
    throw error
  }
}

export async function runAgentWake(
  organizationId: string,
  payload: AgentWakePayload,
  attempt: JobAttempt
): Promise<Result> {
  const done: Result = { done: true, payload }
  const wake = await findWake(organizationId, payload.wakeId)
  if (!wake || wake.status !== 'queued') return done

  const end = async (status: 'suppressed', reason: string): Promise<Result> => {
    if (await settleWake(organizationId, payload.wakeId, { status, reason })) {
      void announceAgentWork(wake)
      auditSuppressedWake({
        organizationId,
        actor: payload.actor,
        annotationId: payload.annotationId,
        documentId: payload.documentId,
        trigger: payload.trigger,
        status,
        reason,
        stage: 'claim',
      })
    }
    return done
  }

  const session = await resolvePinnedRequesterSession({
    userId: payload.actor.userId,
    email: payload.actor.email,
    organizationId,
  })
  if (!session) return end('suppressed', 'the person is no longer a member')
  if (!wakesEnabled(session)) return end('suppressed', 'piloti-wakes is off for the organization')
  const doc = await writableDocument(session, payload.documentId)
  if (!doc) return end('suppressed', 'the person may no longer write the document')
  const mark = await findDocumentAnnotation(organizationId, doc.id, payload.annotationId)
  if (!mark) return end('suppressed', 'the mark is gone')
  const fail = async (status: 'refused' | 'failed', reason: string): Promise<Result> => {
    if (await settleWake(organizationId, payload.wakeId, { status, reason })) {
      void announceAgentWork(wake)
      await afterEndWithoutAnswer({ organizationId, payload, doc, mark, status, reason })
    }
    return done
  }
  const wait = (reason: string): Promise<Result> | Result => {
    if (payload.waits >= MAX_WAKE_WAITS) return fail('failed', `gave up waiting: ${reason}`)
    return {
      done: false,
      payload: { ...payload, waits: payload.waits + 1 },
      notBefore: new Date(Date.now() + waitAfter(payload.waits)),
    }
  }
  if (
    payload.trigger === 'assigned' &&
    (!mark.delegatedAt || delegationEventId(mark.id, mark.delegatedAt) !== payload.eventId)
  ) {
    return end('suppressed', 'taken back')
  }
  const cap = await capReached(getDb(), { organizationId, annotationId: mark.id, actor: payload.actor }, new Date(), undefined, {
    createdAt: wake.createdAt,
    id: wake.id,
  })
  if (cap) return end('suppressed', cap)
  const text = questionOf(payload, mark)?.trim()
  if (!text) return end('suppressed', 'the reply is gone')

  const authorName = session.name
  let conversationId: string
  try {
    conversationId = await ensureDocumentThread(session, doc)
  } catch (error) {
    if (isAuthzRefusal(error)) return end('suppressed', 'the person may no longer chat here')
    if (error instanceof ApiError && error.status === 409) return wait('the thread is being deleted')
    throw error
  }
  await recordTrigger(conversationId, payload, mark, authorName || session.email || 'Jemand', text)

  let context: Awaited<ReturnType<typeof resolveTurnContext>>
  try {
    context = await resolveTurnContext(session, { projectId: doc.projectId ?? undefined, conversationId })
  } catch (error) {
    if (error instanceof TurnBudgetExhaustedError) return fail('refused', `budget: ${error.message}`)
    if (isAuthzRefusal(error)) return end('suppressed', 'the person may no longer chat here')
    throw error
  }
  const secret = process.env.INTERNAL_API_TOKEN
  if (!secret) throw new Error('INTERNAL_API_TOKEN is not set: a wake cannot sign its turn')

  const outcome = await runHeadlessTurn({
    url: chatSocketUrl(conversationId),
    conversationId,
    projectId: context.projectId,
    headers: { ...turnContextHeaders(context, { issuedAt: Date.now(), secret }), ...HEADLESS_MODE_HEADERS },
    message: wakeMessage({ payload, conversationId, doc, mark, text, authorName }),
    requires: WAKE_REQUIRES,
  })
  switch (outcome.kind) {
    case 'started':
    case 'duplicate':
      if (await settleWake(organizationId, payload.wakeId, { status: 'started' })) {
        void announceAgentWork(wake)
        auditWakeStarted(auditedWake(organizationId, payload, doc, mark), payload.waits)
      }
      return done
    case 'busy':
      return wait('another turn of the thread ran')
    case 'unavailable':
      return wait(outcome.reason)
    case 'refused':
      return fail('refused', outcome.reason)
    case 'rejected':
      if ((outcome.code === 'auth_expired' || outcome.code === 'conversation_mismatch') && !attempt.last) {
        throw new Error(`the chat socket refused the wake: ${outcome.code}`)
      }
      return fail('failed', `rejected: ${outcome.code}${outcome.message ? ` (${outcome.message})` : ''}`)
  }
}
