import 'server-only'
import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentAnnotationReplyRow, AgentWakeRow } from '@/lib/db/schema/document-annotations'
import type { Document } from '@/lib/db/schema/documents'
import {
  deleteAnnotationReply,
  findDocumentAnnotation,
  insertAnnotationReply,
  ReplyLimitReachedError,
  updateAnnotationReply,
  type AnnotationRecord,
} from './repository'
import { onMarkReplied, onReplyDeleted, onReplyEdited } from './attention'
import { keepMentions, mentionsAgent, newlyMentioned, noLongerMentioned } from './mentions'
import { enqueueWake, replyTrigger, wakeOutcomeOf, wakesEnabled, type EnqueuedWake } from './wake'
import { wakeTurnId } from './wake-ids'
import { findWake } from './wake-repository'
import {
  createReplyRequestSchema,
  MAX_REPLIES_PER_ANNOTATION,
  agentRepliedSince,
  REPLY_MARK_CLOSED_REASON,
  REPLY_TAKEN_UP_REASON,
  replyIsForAgent,
  isLive,
  updateReplyRequestSchema,
  type AnnotationView,
  type CreateReplyRequest,
  type UpdateReplyRequest,
  type WakeOutcome,
} from './types'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind } from '@/lib/agent-kind'
import { type AnnotationActor, PERSON, requireWritableDocument } from './annotation-access'
import { announce } from './annotation-events'
import { viewOf } from './annotation-views'
import {
  bestEffort,
  traceSettled,
  spendMentions,
  traceWithdrawn,
  traceMentioned,
  markRefOf,
  mayOpenOf,
} from './annotation-notifications'
import { conflict } from './annotation-errors'
import { auditHeldWake } from './annotation-delegation'

export async function replyToAnnotation(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  input: CreateReplyRequest,
  actor: AnnotationActor = PERSON
): Promise<{ annotation: AnnotationView; replyId: string; wake: WakeOutcome }> {
  const { doc, existing, reply, wake, mentioned } = await postReply(session, documentId, annotationId, input, actor)
  traceMentioned(session, doc, existing, mentioned, reply.body, reply.mentions, null, reply.id)
  bestEffort('tell the thread', () =>
    onMarkReplied({
      ...markRefOf(session, doc, existing),
      actorUserId: session.userId,
      byAgent: isAgentKind(actor.kind),
      markText: existing.body,
      mark: existing,
      replyText: reply.body,
      replyId: reply.id,
      replyMentions: reply.mentions,
      mayOpen: mayOpenOf(session, doc),
      mentioned,
    })
  )
  return { annotation: await viewOf(session, doc, annotationId), replyId: reply.id, wake }
}

export async function postReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  input: CreateReplyRequest,
  actor: AnnotationActor
): Promise<{
  doc: Document
  existing: AnnotationRecord
  reply: DocumentAnnotationReplyRow
  wake: WakeOutcome
  mentioned: string[]
}> {
  const { body, addressesPiloti, mentions: picked } = createReplyRequestSchema.parse(input)
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  if (!existing) throw new NotFoundError()
  const mentions = actor.kind === 'person' ? await keepMentions(session, doc, body, picked ?? [], { piloti: true }) : []
  const mentioned = await spendMentions(session, newlyMentioned(mentions, [], session.userId), mentionsAgent(mentions))
  const addresses = actor.kind === 'person' && (Boolean(addressesPiloti) || mentionsAgent(mentions))
  const trigger = replyTrigger(existing, { authorKind: actor.kind, addressesPiloti: addresses })
  const enabled = trigger !== null && wakesEnabled(session)
  const enqueued: { wake: EnqueuedWake | null } = { wake: null }
  const reply = await insertAnnotationReply(
    {
      organizationId: session.organizationId,
      annotationId,
      authorKind: actor.kind,
      body,
      createdBy: session.userId,
      addressesAgent: addresses,
      mentions,
    },
    enabled && trigger
      ? async (tx, row) => {
          enqueued.wake = await enqueueWake(tx, {
            organizationId: session.organizationId,
            documentId: doc.id,
            annotationId,
            trigger,
            eventId: row.id,
            actor: { userId: session.userId, email: session.email || null },
          })
        }
      : undefined
  ).catch((error: unknown) => {
    if (error instanceof ReplyLimitReachedError) {
      throw new UnprocessableError(`A thread carries at most ${MAX_REPLIES_PER_ANNOTATION} replies.`)
    }
    throw error
  })
  announce(session, doc.id, [annotationId], 'replied', actor)
  if (trigger) auditHeldWake(session, doc.id, annotationId, trigger, enqueued.wake)
  if (actor.kind === 'person') traceSettled(session, annotationId, false)
  const outcome: WakeOutcome = trigger === null ? 'none' : enabled ? wakeOutcomeOf(enqueued.wake) : 'off'
  return { doc, existing, reply, wake: outcome, mentioned }
}

export async function deleteReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string,
  options: { expectedBody?: string; actor?: AnnotationActor } = {}
): Promise<null> {
  const actor = options.actor ?? PERSON
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  const reply = existing?.replies.find((candidate) => candidate.id === replyId)
  if (!existing || !reply) throw new NotFoundError()
  if (reply.createdBy !== session.userId) {
    throw new ForbiddenError('Only the person an answer was written for can delete it.')
  }
  if (options.expectedBody !== undefined && options.expectedBody !== reply.body) throw conflict()
  await removeReply(session, doc, existing, reply, options.expectedBody, actor)
  return null
}

async function removeReply(
  session: AuthorizedSession,
  doc: Document,
  existing: AnnotationRecord,
  reply: DocumentAnnotationReplyRow,
  expectedBody: string | undefined,
  actor: AnnotationActor
): Promise<void> {
  const gone = await deleteAnnotationReply(session.organizationId, existing.id, reply.id, expectedBody)
  if (!gone) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  const left = existing.replies.filter((candidate) => candidate.id !== reply.id)
  const withdrawn = noLongerMentioned(reply.mentions, [existing.mentions, ...left.map((candidate) => candidate.mentions)])
  bestEffort('clear the deleted reply’s rows', () =>
    onReplyDeleted({ organizationId: session.organizationId, annotationId: existing.id, replyId: reply.id, withdrawn })
  )
}

const TAKEN_UP_WAKES: ReadonlySet<AgentWakeRow['status']> = new Set(['queued', 'started', 'answered', 'stopped'])

async function agentTookUp(
  session: AuthorizedSession,
  mark: AnnotationRecord,
  reply: DocumentAnnotationReplyRow
): Promise<boolean> {
  if (!replyIsForAgent(mark, { authorKind: reply.authorKind, addressesPiloti: reply.addressesAgent })) return false
  if (agentRepliedSince(mark.replies, reply)) return true
  const wake = await findWake(session.organizationId, wakeTurnId(reply.id))
  return wake !== null && TAKEN_UP_WAKES.has(wake.status)
}

async function ownReplyOf(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string
): Promise<{ doc: Document; existing: AnnotationRecord; reply: DocumentAnnotationReplyRow }> {
  const doc = await requireWritableDocument(session, documentId)
  const existing = await findDocumentAnnotation(session.organizationId, doc.id, annotationId)
  const reply = existing?.replies.find((candidate) => candidate.id === replyId)
  if (!existing || !reply) throw new NotFoundError()
  if (reply.authorKind !== 'person' || reply.createdBy !== session.userId) {
    throw new ForbiddenError('Only the person who wrote an answer can change it.')
  }
  if (!isLive(existing)) {
    throw new UnprocessableError('The Anmerkung is closed: its thread stays as it was.', {
      reason: REPLY_MARK_CLOSED_REASON,
    })
  }
  if (await agentTookUp(session, existing, reply)) {
    throw new ConflictError(PRODUCT_NAME + ' has taken this answer up: it stays as it was. Write a new one.', {
      reason: REPLY_TAKEN_UP_REASON,
    })
  }
  return { doc, existing, reply }
}

export async function editReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string,
  input: UpdateReplyRequest,
  actor: AnnotationActor = PERSON
): Promise<{ annotation: AnnotationView }> {
  const { body, mentions: picked } = updateReplyRequestSchema.parse(input)
  const { doc, existing, reply } = await ownReplyOf(session, documentId, annotationId, replyId)
  const mentions = await keepMentions(session, doc, body, picked ?? reply.mentions, {
    piloti: mentionsAgent(reply.mentions),
  })
  const mentioned = await spendMentions(session, newlyMentioned(mentions, reply.mentions, session.userId), false)
  const others = existing.replies.filter((candidate) => candidate.id !== reply.id)
  const withdrawn = noLongerMentioned(reply.mentions, [mentions, existing.mentions, ...others.map((other) => other.mentions)])
  const updated = await updateAnnotationReply(session.organizationId, existing.id, reply.id, reply.body, {
    body,
    mentions,
  })
  if (!updated) throw conflict()
  announce(session, doc.id, [existing.id], 'updated', actor)
  bestEffort('reword the reply’s rows', () =>
    onReplyEdited({
      organizationId: session.organizationId,
      annotationId: existing.id,
      replyId: updated.id,
      text: updated.body,
      mentions: updated.mentions,
    })
  )
  traceMentioned(session, doc, existing, mentioned, updated.body, updated.mentions, null, updated.id)
  traceWithdrawn(session, existing.id, withdrawn)
  return { annotation: await viewOf(session, doc, existing.id) }
}

export async function deleteOwnReply(
  session: AuthorizedSession,
  documentId: string,
  annotationId: string,
  replyId: string,
  actor: AnnotationActor = PERSON
): Promise<null> {
  const { doc, existing, reply } = await ownReplyOf(session, documentId, annotationId, replyId)
  await removeReply(session, doc, existing, reply, reply.body, actor)
  return null
}
