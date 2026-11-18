import type { InboxItemView } from '@/lib/inbox/types'

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

function markThread(documentId: string, markId: string): MarkView {
  const kept = threads.get(markId)
  if (kept) return kept
  const created = daysAgo(2)
  const mark: MarkView = {
    id: markId, documentId, number: Number(markId.replace(/\D/g, '')) || 1, page: 1, shape: 'point', x: 0.4, y: 0.4, w: null, h: null,
    kind: 'question', body: 'Anmerkung', mentions: [], basis: null, authorKind: 'person',
    status: 'open', assigneeUserId: VIEWER_ID, assigneeName: 'Miriam Hofer', dueOn: null, revisionNumber: 3,
    onCurrentRevision: true, createdBy: 'u-anna', createdByName: 'Anna Weber', createdAt: created, updatedAt: created,
    acceptedBy: null, acceptedByName: null, closedBy: null, closedByName: null, closedAt: null,
    delegatedBy: null, delegatedByName: null, delegatedAt: null, canEdit: true, canDelete: false, replies: [],
  }
  threads.set(markId, mark)
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
  threads.set(markId, annotation)
  return { annotation, replyId, wake: sent.addressesPiloti ? 'queued' : 'none' }
}
