import type {
  AnnotationAuthor,
  AnnotationKind,
  AnnotationStatus,
  UpdateAnnotationRequest,
} from '@/lib/annotations/types'
import type { CardDecision } from '../card-decision'

export interface CanvasProposedItem {
  action: 'proposed'
  annotation_id: string
  number: number
  page: number
  shape: 'point' | 'region'
  x: number
  y: number
  w?: number | null
  h?: number | null
  kind: AnnotationKind
  body: string
}

export interface CanvasCreatedItem extends Omit<CanvasProposedItem, 'action'> {
  action: 'created'
}

export interface CanvasFieldChange {
  field: 'status' | 'assignee' | 'due_on' | 'kind' | 'body'
  before?: string | null
  after?: string | null
  before_label?: string | null
  after_label?: string | null
}

export interface CanvasChangedItem {
  action: 'changed'
  annotation_id: string
  number: number
  status: AnnotationStatus
  changes: CanvasFieldChange[]
  note: string
}

export interface CanvasDeletedItem {
  action: 'deleted'
  number: number
  body: string
}

export interface CanvasRepliedItem {
  action: 'replied'
  annotation_id: string
  number: number
  excerpt: string
}

export type CanvasActivityItem =
  | CanvasProposedItem
  | CanvasCreatedItem
  | CanvasChangedItem
  | CanvasDeletedItem
  | CanvasRepliedItem

export type CanvasSetItem = CanvasProposedItem | CanvasCreatedItem

export interface CanvasActivityDocument {
  id: string
  name: string
}

export const isProposed = (item: CanvasActivityItem): item is CanvasProposedItem => item.action === 'proposed'
export const isSet = (item: CanvasActivityItem): item is CanvasSetItem =>
  item.action === 'proposed' || item.action === 'created'

export const annotationIdOf = (item: CanvasActivityItem): string | null =>
  item.action === 'deleted' ? null : item.annotation_id

export type MarkState = AnnotationStatus | 'gone'

export interface LastReply {
  authorKind: AnnotationAuthor
  authorName: string | null
  body: string
}

export interface LiveMark {
  status: AnnotationStatus
  canEdit: boolean
  acceptedByName: string | null
  closedByName: string | null
  assigneeUserId: string | null
  dueOn: string | null
  kind: AnnotationKind
  body: string
  replyCount: number
  lastReply: LastReply | null
}

export function firstWords(text: string, max = 60): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > max / 2 ? cut.slice(0, boundary) : cut).replace(/[\s.,;:!?-]+$/, '')}…`
}

export function markState(decision: CardDecision | null, live: LiveMark | 'gone' | undefined): MarkState {
  if (live === 'gone') return 'gone'
  if (live && live.status !== 'proposed') return live.status
  if (decision === 'accepted') return 'open'
  if (decision === 'rejected') return 'dismissed'
  return 'proposed'
}

export function createdState(live: LiveMark | 'gone' | undefined): MarkState {
  if (live === 'gone') return 'gone'
  return live ? live.status : 'open'
}

export function activityCounts(items: readonly CanvasActivityItem[]): {
  proposed: number
  created: number
  changed: number
  deleted: number
  replied: number
  repliedNumber: number | null
} {
  const replies = items.filter((item) => item.action === 'replied')
  const threads = new Set(replies.map((item) => item.number))
  const changed = new Set(items.filter((item) => item.action === 'changed').map((item) => item.number))
  return {
    proposed: items.filter((item) => item.action === 'proposed').length,
    created: items.filter((item) => item.action === 'created').length,
    changed: changed.size,
    deleted: items.filter((item) => item.action === 'deleted').length,
    replied: threads.size,
    repliedNumber: threads.size === 1 ? replies[0].number : null,
  }
}

const isKind = (value: string | null | undefined): value is AnnotationKind =>
  value === 'hint' || value === 'question' || value === 'defect'

const isReversible = (value: string | null | undefined): value is 'open' | 'resolved' =>
  value === 'open' || value === 'resolved'

export function undoRequest(item: CanvasChangedItem): UpdateAnnotationRequest | null {
  const request: UpdateAnnotationRequest = { expectedStatus: item.status }
  for (const change of item.changes) {
    const before = change.before ?? null
    if (change.field === 'status') {
      if (!isReversible(before) || !isReversible(change.after)) return null
      request.status = before
    } else if (change.field === 'assignee') {
      request.assigneeUserId = before
    } else if (change.field === 'due_on') {
      request.dueOn = before
    } else if (change.field === 'kind') {
      if (!isKind(before)) return null
      request.kind = before
    } else {
      if (!before) return null
      request.body = before
    }
  }
  return request
}

export function stillAsLeft(item: CanvasChangedItem, live: LiveMark): boolean {
  if (live.status !== item.status) return false
  return item.changes.every((change) => {
    const after = change.after ?? null
    if (change.field === 'status') return true
    if (change.field === 'assignee') return live.assigneeUserId === after
    if (change.field === 'due_on') return live.dueOn === after
    if (change.field === 'kind') return live.kind === after
    return live.body === after
  })
}

export function placeStyle(item: Pick<CanvasProposedItem, 'shape' | 'x' | 'y' | 'w' | 'h'>): {
  left: string
  top: string
  width?: string
  height?: string
} {
  const pct = (value: number) => `${Math.min(1, Math.max(0, value)) * 100}%`
  if (item.shape !== 'region' || !item.w || !item.h) return { left: pct(item.x), top: pct(item.y) }
  return { left: pct(item.x), top: pct(item.y), width: pct(item.w), height: pct(item.h) }
}
