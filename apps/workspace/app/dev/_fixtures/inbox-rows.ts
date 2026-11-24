import type { InboxItemView } from '@/lib/inbox/types'
import { annotationReplyViewSchema } from '@/lib/annotations/types'

export function withProjects(items: readonly InboxItemView[]): InboxItemView[] {
  return items.map((item) =>
    item.href?.includes('/projects/p1') && item.state !== 'inert'
      ? item.resourceId === 'd-schnitt'
        ? { ...item, projectId: 'p2', projectName: 'Volksschule Am Hang' }
        : { ...item, projectId: 'p1', projectName: 'Wohnanlage Linzer Straße' }
      : item,
  )
}

export const MENTIONABLE = [
  { userId: 'u-anna', name: 'Anna Weber', email: 'anna@buero.at', profilePictureUrl: null },
  { userId: 'u-jakob', name: 'Jakob Huber', email: 'jakob@buero.at', profilePictureUrl: null },
  { userId: 'u-markus', name: 'Markus Lehner', email: 'markus@buero.at', profilePictureUrl: null },
]

export const VIEWER_ID = 'u-miriam'

type MarkView = import('@/lib/annotations/types').AnnotationView
type ReplyView = import('@/lib/annotations/types').AnnotationReplyView

const threads = new Map<string, MarkView>()
const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString()

export interface MarkSeed {
  body: string
  authorName?: string | null
  question?: string | null
}

const at = (number: number, step: number, from: number, span: number): number => Math.round((from + ((number * step) % span)) * 1000) / 1000

export function markThread(documentId: string, markId: string, seed?: MarkSeed): MarkView {
  const key = `${documentId}/${markId}`
  const kept = threads.get(key)
  if (kept) return kept
  const created = daysAgo(2)
  const number = Number(markId.replace(/\D/g, '')) || 1
  const mark: MarkView = {
    id: markId, documentId, number, page: 1, shape: 'region',
    x: at(number, 0.137, 0.12, 0.6), y: at(number, 0.093, 0.18, 0.5), w: 0.14, h: 0.1,
    kind: 'question', body: seed?.body ?? 'Anmerkung', mentions: [], basis: null, authorKind: 'person',
    status: 'open', assigneeUserId: VIEWER_ID, assigneeName: 'Miriam Hofer', dueOn: null, revisionNumber: 3,
    onCurrentRevision: true, createdBy: 'u-anna', createdByName: seed?.authorName ?? 'Anna Weber', createdAt: created, updatedAt: created,
    acceptedBy: null, acceptedByName: null, closedBy: null, closedByName: null, closedAt: null,
    delegatedBy: null, delegatedByName: null, delegatedAt: null, canEdit: true, canDelete: false,
    replies: seed?.question
      ? [annotationReplyViewSchema.parse({ id: `${markId}-asks`, annotationId: markId, authorKind: 'agent', body: seed.question, createdBy: 'agent', createdByName: null, createdAt: daysAgo(0.01), mentions: [], editedAt: null })]
      : [],
  }
  threads.set(key, mark)
  return mark
}

export function replyToMark(documentId: string, markId: string, sent: Pick<ReplyView, 'body' | 'mentions' | 'addressesPiloti'>) {
  const mark = markThread(documentId, markId)
  const replyId = `reply-${Date.now()}`
  const reply: ReplyView = {
    id: replyId, annotationId: markId, authorKind: 'person', body: sent.body, createdBy: VIEWER_ID,
    createdByName: 'Miriam Hofer', createdAt: new Date().toISOString(), addressesPiloti: sent.addressesPiloti === true,
    mentions: sent.mentions ?? [], editedAt: null,
  }
  const annotation = { ...mark, replies: [...mark.replies, reply] }
  threads.set(`${documentId}/${markId}`, annotation)
  return { annotation, replyId, wake: sent.addressesPiloti ? 'queued' : 'none' }
}
