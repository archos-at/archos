import 'server-only'

import { findDocumentAnnotation, type AnnotationRecord } from './repository'
import { isLive, type MarkMention } from './types'
import { wakeEndReasonKind } from './wake-end-reason'
import { listAssignmentsForResources } from '@/lib/assignments/repository'
import { bestEffortInbox } from '@/lib/inbox/best-effort'
import { inboxGroupKey, MARK_ANCHORED_INBOX_TYPES, MARKS_SET_GROUP_ANCHOR } from '@/lib/inbox/registry'
import {
  emitInboxItems,
  markInboxItemsInertAnchoredOn,
  resolveInboxItemsAnchoredOn,
  retractInboxOccurrenceAnchoredOn,
  rewriteInboxPayloadsAnchoredOn,
} from '@/lib/inbox/service'
import type { DocumentAnnotationReplyRow } from '@/lib/db/schema/document-annotations'
import type { InboxItemType } from '@/lib/db/schema/inbox'
import { AGENT_MENTION_ID } from '@/lib/mentions/types'
import { describeResource } from '@/lib/sharing/registry'

export interface MarkRef {
  organizationId: string
  documentId: string
  annotationId: string
  annotationNumber: number
  projectId: string | null
}

const QUOTE_KEYS = ['excerpt', 'mentions'] as const

const EXCERPT_LENGTH = 160

function excerptOf(text: string | null | undefined): string | null {
  const trimmed = text?.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  return trimmed.length > EXCERPT_LENGTH ? `${trimmed.slice(0, EXCERPT_LENGTH - 1)}…` : trimmed
}

async function documentName(ref: MarkRef): Promise<string | null> {
  try {
    const found = await describeResource('document').describeRef(ref.documentId, ref.organizationId)
    return found?.title ?? null
  } catch {
    return null
  }
}

interface MarkItem {
  excerpt: string | null
  mentions?: readonly MarkMention[]
  variant?: string | null
  actorUserId?: string | null
  author?: string | null
  facts?: Record<string, string | number | null>
  groupAnchor?: string
  occurrences?: number
}

async function emitAboutMark(
  type: InboxItemType,
  ref: MarkRef,
  recipientUserIds: readonly string[],
  { excerpt, mentions = [], variant = null, actorUserId = null, author = null, facts = {}, groupAnchor, occurrences }: MarkItem
): Promise<void> {
  if (recipientUserIds.length === 0) return
  const subject = await documentName(ref)
  const payload = {
    ...(subject ? { subject } : {}),
    related: String(ref.annotationNumber),
    ...(excerpt ? { excerpt, mentions: [...mentions] } : {}),
    ...(variant ? { variant } : {}),
    ...facts,
  }
  await emitInboxItems(
    recipientUserIds.map((recipientUserId) => ({
      organizationId: ref.organizationId,
      recipientUserId,
      type,
      resourceType: 'document',
      resourceId: ref.documentId,
      anchorId: ref.annotationId,
      actorUserId,
      groupKey: inboxGroupKey(type, 'document', ref.documentId, groupAnchor ?? ref.annotationId),
      payload: author !== null && recipientUserId === author ? { ...payload, yours: true } : payload,
      ...(occurrences !== undefined && { occurrences }),
    }))
  )
}

export type MayOpen = (userIds: readonly string[]) => Promise<ReadonlySet<string>>

export type MarkPeople = Pick<AnnotationRecord, 'authorKind' | 'createdBy' | 'acceptedBy' | 'assigneeUserId' | 'delegatedBy'> &
  Partial<Pick<AnnotationRecord, 'mentions'>> & {
    replies: ReadonlyArray<
      Pick<DocumentAnnotationReplyRow, 'authorKind' | 'createdBy'> & Partial<Pick<DocumentAnnotationReplyRow, 'mentions'>>
    >
  }

export const markAuthor = (mark: Pick<MarkPeople, 'authorKind' | 'createdBy' | 'acceptedBy'>): string | null =>
  mark.authorKind === 'person' ? mark.createdBy : mark.acceptedBy

export function markParticipants(mark: MarkPeople): string[] {
  const mentioned = [mark.mentions ?? [], ...mark.replies.map((reply) => reply.mentions ?? [])]
    .flat()
    .map((mention) => mention.targetId)
    .filter((targetId) => targetId !== AGENT_MENTION_ID)
  const people = [
    markAuthor(mark),
    mark.assigneeUserId,
    mark.delegatedBy,
    ...mark.replies.filter((reply) => reply.authorKind === 'person').map((reply) => reply.createdBy),
    ...mentioned,
  ]
  return [...new Set(people.filter((userId): userId is string => Boolean(userId)))]
}

async function whoMayOpen(mayOpen: MayOpen, userIds: readonly string[]): Promise<string[]> {
  if (userIds.length === 0) return []
  const allowed = await mayOpen(userIds)
  return userIds.filter((userId) => allowed.has(userId))
}

export async function onWakeEnded(
  input: MarkRef & {
    actorUserId: string
    trigger: 'thread_mention' | 'thread_reply' | 'assigned'
    outcome: 'answered' | 'stopped' | 'failed'
    reason?: string | null
    markText?: string | null
  }
): Promise<void> {
  if (input.outcome === 'stopped') return
  const type = input.outcome === 'answered' ? 'piloti.work_done' : 'piloti.work_failed'
  const variant =
    input.outcome === 'failed' ? (wakeEndReasonKind('failed', input.reason ?? null) ?? 'error') : input.trigger
  await bestEffortInbox(`${type} for mark ${input.annotationId}`, input.organizationId, () =>
    emitAboutMark(type, input, [input.actorUserId], { excerpt: excerptOf(input.markText), variant })
  )
}

function waitsOnPerson(mark: Pick<AnnotationRecord, 'kind' | 'authorKind' | 'status'>): boolean {
  return mark.kind === 'question' && mark.authorKind === 'piloti' && isLive(mark)
}

export async function onAgentWrote(
  input: MarkRef & {
    onBehalfOf: string
    assigneeUserId: string | null
    what: 'mark' | 'question' | 'reply'
    replyId: string | null
  }
): Promise<void> {
  if (input.what === 'mark') return
  await bestEffortInbox(`piloti.asks_you for mark ${input.annotationId}`, input.organizationId, async () => {
    const mark = await findDocumentAnnotation(input.organizationId, input.documentId, input.annotationId)
    if (!mark) return
    if (!waitsOnPerson(mark)) return
    const written =
      input.what === 'reply' ? mark.replies.find((reply) => reply.id === input.replyId)?.body : mark.body
    await emitAboutMark('piloti.asks_you', input, [input.assigneeUserId ?? input.onBehalfOf], {
      excerpt: excerptOf(written),
    })
  })
}

export async function onMarkSettledByPerson(
  input: Pick<MarkRef, 'organizationId' | 'annotationId'> & { closed: boolean; answeredBy?: string | null }
): Promise<void> {
  await bestEffortInbox(`settling mark ${input.annotationId}`, input.organizationId, async () => {
    await resolveInboxItemsAnchoredOn({
      organizationId: input.organizationId,
      types: input.closed
        ? ['piloti.asks_you', 'annotation.assigned_to_you', 'annotation.mentioned']
        : ['piloti.asks_you'],
      anchorId: input.annotationId,
    })
    if (input.closed || !input.answeredBy) return
    await resolveInboxItemsAnchoredOn({
      organizationId: input.organizationId,
      types: ['annotation.mentioned'],
      anchorId: input.annotationId,
      recipientUserId: input.answeredBy,
    })
  })
}

export async function onMarkDeleted(input: Pick<MarkRef, 'organizationId' | 'annotationId'>): Promise<void> {
  const rows = { organizationId: input.organizationId, anchorId: input.annotationId }
  await bestEffortInbox(`clearing deleted mark ${input.annotationId}`, input.organizationId, async () => {
    await markInboxItemsInertAnchoredOn({
      ...rows,
      types: MARK_ANCHORED_INBOX_TYPES,
      groupAnchor: { isNot: MARKS_SET_GROUP_ANCHOR },
    })
    await retractInboxOccurrenceAnchoredOn({
      ...rows,
      types: ['annotation.activity'],
      groupAnchor: { is: MARKS_SET_GROUP_ANCHOR },
      clear: [...QUOTE_KEYS, 'related'],
      inertWhenSpent: true,
    })
  })
}

export interface MarkAct extends MarkRef {
  actorUserId: string
  byAgent: boolean
  markText: string | null
}

export async function onAssigneeChanged(
  input: MarkAct & {
    previousAssigneeUserId: string | null
    assigneeUserId: string | null
    open: boolean
    dueOn: string | null
  }
): Promise<void> {
  const { previousAssigneeUserId: previous, assigneeUserId: assignee } = input
  await bestEffortInbox(`annotation.assigned_to_you for mark ${input.annotationId}`, input.organizationId, async () => {
    if (previous && previous !== assignee) {
      await resolveInboxItemsAnchoredOn({
        organizationId: input.organizationId,
        types: ['annotation.assigned_to_you'],
        anchorId: input.annotationId,
        recipientUserId: previous,
      })
    }
    if (!assignee || assignee === input.actorUserId || !input.open) return
    await emitAboutMark('annotation.assigned_to_you', input, [assignee], {
      excerpt: excerptOf(input.markText),
      variant: input.byAgent ? 'piloti' : 'person',
      actorUserId: input.actorUserId,
      facts: { dueOn: input.dueOn, reminder: null },
    })
  })
}

export async function onDueChanged(
  input: MarkAct & { assigneeUserId: string | null; dueOn: string | null; open: boolean }
): Promise<void> {
  const assignee = input.assigneeUserId
  if (!assignee || assignee === input.actorUserId || !input.open) return
  const variant = `${input.dueOn ? 'due' : 'due_cleared'}${input.byAgent ? '_piloti' : ''}`
  await bestEffortInbox(`annotation.assigned_to_you (date) for mark ${input.annotationId}`, input.organizationId, () =>
    emitAboutMark('annotation.assigned_to_you', input, [assignee], {
      excerpt: excerptOf(input.markText),
      variant,
      actorUserId: input.actorUserId,
      facts: { dueOn: input.dueOn, reminder: null },
    })
  )
}

export type DueReminder = 'due_soon' | 'overdue'

export async function onMarkDue(
  input: MarkRef & { assigneeUserId: string; dueOn: string; reminder: DueReminder; markText: string | null }
): Promise<void> {
  await emitAboutMark('annotation.assigned_to_you', input, [input.assigneeUserId], {
    excerpt: excerptOf(input.markText),
    variant: input.reminder,
    facts: { dueOn: input.dueOn, reminder: remindedFor(input.reminder, input.dueOn) },
  })
}

export const remindedFor = (reminder: DueReminder, dueOn: string): string => `${reminder}:${dueOn}`

export async function onMarkReplied(
  input: MarkAct & {
    mark: MarkPeople & Pick<AnnotationRecord, 'kind' | 'status'>
    replyText: string
    replyId?: string | null
    mayOpen: MayOpen
    mentioned?: readonly string[]
    replyMentions?: readonly MarkMention[]
  }
): Promise<void> {
  await bestEffortInbox(`annotation.activity for mark ${input.annotationId}`, input.organizationId, async () => {
    const asked = input.byAgent && waitsOnPerson(input.mark) ? input.mark.assigneeUserId : null
    const toldOtherwise = new Set([input.actorUserId, asked, ...(input.mentioned ?? [])])
    const candidates = markParticipants(input.mark).filter((userId) => !toldOtherwise.has(userId))
    await emitAboutMark('annotation.activity', input, await whoMayOpen(input.mayOpen, candidates), {
      excerpt: excerptOf(input.replyText),
      mentions: input.replyMentions,
      variant: 'reply',
      actorUserId: input.byAgent ? null : input.actorUserId,
      author: markAuthor(input.mark),
      facts: { replyId: input.replyId ?? null },
    })
  })
}

export type MarksSetBy = 'created' | 'created_piloti'

export interface SetMark {
  id: string
  number: number
  body: string
  mentions?: readonly MarkMention[]
  toldOtherwise: readonly (string | null)[]
}

export async function onMarksSet(
  input: Omit<MarkRef, 'annotationId' | 'annotationNumber'> & {
    actorUserId: string
    uploaderUserId: string | null
    by: MarksSetBy
    marks: readonly SetMark[]
    mayOpen: MayOpen
  }
): Promise<void> {
  if (input.marks.length === 0) return
  await bestEffortInbox(`annotation.activity (set) on document ${input.documentId}`, input.organizationId, async () => {
    const assignments = await listAssignmentsForResources(input.organizationId, 'document', [input.documentId])
    const people = [...new Set([...assignments.map((row) => row.subjectUserId), input.uploaderUserId])].filter(
      (userId): userId is string => Boolean(userId) && userId !== input.actorUserId
    )
    const recipients = await whoMayOpen(input.mayOpen, people)
    const byShare = new Map<string, { newest: SetMark; count: number; recipients: string[] }>()
    for (const recipient of recipients) {
      const theirs = input.marks.filter((mark) => !mark.toldOtherwise.includes(recipient))
      if (theirs.length === 0) continue
      const newest = theirs.reduce((a, b) => (b.number > a.number ? b : a))
      const key = `${newest.id}\n${theirs.length}`
      const share = byShare.get(key) ?? { newest, count: theirs.length, recipients: [] }
      share.recipients.push(recipient)
      byShare.set(key, share)
    }
    for (const { newest, count, recipients: told } of byShare.values()) {
      await emitAboutMark(
        'annotation.activity',
        { ...input, annotationId: newest.id, annotationNumber: newest.number },
        told,
        {
          excerpt: excerptOf(newest.body),
          mentions: newest.mentions,
          variant: input.by,
          actorUserId: input.actorUserId,
          groupAnchor: `${MARKS_SET_GROUP_ANCHOR}${input.by}:${input.actorUserId}`,
          occurrences: count,
        }
      )
    }
  })
}

export async function onMarkMoved(
  input: MarkAct & {
    move: 'resolved' | 'dismissed' | 'reopened'
    mark: Pick<MarkPeople, 'authorKind' | 'createdBy' | 'acceptedBy'>
    mayOpen: MayOpen
  }
): Promise<void> {
  const author = markAuthor(input.mark)
  if (!author || author === input.actorUserId) return
  await bestEffortInbox(`annotation.activity for mark ${input.annotationId}`, input.organizationId, async () =>
    emitAboutMark('annotation.activity', input, await whoMayOpen(input.mayOpen, [author]), {
      excerpt: excerptOf(input.markText),
      variant: input.move,
      actorUserId: input.actorUserId,
      author,
      facts: { replyId: null },
    })
  )
}

export async function onMarkMentioned(
  input: MarkAct & {
    mentioned: readonly string[]
    text: string
    mentions: readonly MarkMention[]
    replyId?: string | null
    mayOpen: MayOpen
  }
): Promise<void> {
  const recipients = input.mentioned.filter((userId) => userId !== input.actorUserId)
  if (recipients.length === 0) return
  await bestEffortInbox(`annotation.mentioned for mark ${input.annotationId}`, input.organizationId, async () =>
    emitAboutMark('annotation.mentioned', input, await whoMayOpen(input.mayOpen, recipients), {
      excerpt: excerptOf(input.text),
      mentions: input.mentions,
      actorUserId: input.actorUserId,
      facts: { replyId: input.replyId ?? null },
    })
  )
}

export async function onReplyDeleted(
  input: Pick<MarkRef, 'organizationId' | 'annotationId'> & { replyId: string; withdrawn: readonly string[] }
): Promise<void> {
  await bestEffortInbox(`clearing deleted reply ${input.replyId}`, input.organizationId, async () => {
    await withdrawMentions(input)
    const rows = {
      organizationId: input.organizationId,
      anchorId: input.annotationId,
      payloadHas: { replyId: input.replyId },
      clear: [...QUOTE_KEYS, 'replyId'],
    }
    await retractInboxOccurrenceAnchoredOn({ ...rows, types: ['annotation.mentioned'], inertWhenSpent: false })
    await retractInboxOccurrenceAnchoredOn({ ...rows, types: ['annotation.activity'], inertWhenSpent: true })
  })
}

export async function onReplyEdited(
  input: Pick<MarkRef, 'organizationId' | 'annotationId'> & {
    replyId: string
    text: string
    mentions: readonly MarkMention[]
  }
): Promise<void> {
  await bestEffortInbox(`rewording reply ${input.replyId}`, input.organizationId, () =>
    rewriteInboxPayloadsAnchoredOn({
      organizationId: input.organizationId,
      types: ['annotation.activity', 'annotation.mentioned'],
      anchorId: input.annotationId,
      payloadHas: { replyId: input.replyId },
      facts: { excerpt: excerptOf(input.text), mentions: [...input.mentions] },
    })
  )
}

async function withdrawMentions(
  input: Pick<MarkRef, 'organizationId' | 'annotationId'> & { withdrawn: readonly string[] }
): Promise<void> {
  for (const recipientUserId of input.withdrawn) {
    await markInboxItemsInertAnchoredOn({
      organizationId: input.organizationId,
      types: ['annotation.mentioned'],
      anchorId: input.annotationId,
      recipientUserId,
    })
  }
}

export async function onMentionsWithdrawn(
  input: Pick<MarkRef, 'organizationId' | 'annotationId'> & { userIds: readonly string[] }
): Promise<void> {
  await bestEffortInbox(`withdrawing mentions on mark ${input.annotationId}`, input.organizationId, () =>
    withdrawMentions({ ...input, withdrawn: input.userIds })
  )
}
