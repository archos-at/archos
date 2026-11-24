import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { transition } from '@/lib/annotations/service'
import {
  createAnnotationRequestSchema,
  updateAnnotationRequestSchema,
  type AnnotationView,
  type CreateAnnotationRequest,
  type UpdateAnnotationRequest,
} from '@/lib/annotations/types'
import type { AgentChangeRow } from './repository'
import { matchesState } from './state'
import { PRODUCT_NAME } from '@/lib/brand'
import { isAgentKind } from '@/lib/agent-kind'

export type UndoPlan =
  | { kind: 'dismiss'; request: UpdateAnnotationRequest }
  | { kind: 'revert'; request: UpdateAnnotationRequest }
  | { kind: 'recreate'; mark: CreateAnnotationRequest; status: 'open' | 'resolved' }
  | { kind: 'delete' }
  | { kind: 'delete-reply'; replyId: string; expectedBody: string }

export type UndoOutcome = { plan: UndoPlan } | { refused: 'moved-on'; message: string }

const movedOn = (message = 'This is no longer as ' + PRODUCT_NAME + ' left it.'): UndoOutcome => ({ refused: 'moved-on', message })
const noWayBack = (message: string): UndoOutcome => ({ refused: 'moved-on', message })

const REVERTIBLE = ['status', 'kind', 'body', 'basis', 'assigneeUserId', 'dueOn'] as const

function canMoveBack(current: AnnotationView, to: unknown): to is 'open' | 'resolved' | 'dismissed' {
  if (to !== 'open' && to !== 'resolved' && to !== 'dismissed') return false
  try {
    transition(current.status, to, current, current.createdBy, new Date())
    return true
  } catch (error) {
    if (error instanceof ApiError) return false
    throw error
  }
}

function undoCreate(row: AgentChangeRow, current: AnnotationView | undefined): UndoOutcome {
  if (!current || !row.after || !matchesState(current, row.after)) return movedOn()
  if (current.status === 'proposed') {
    return { plan: { kind: 'dismiss', request: { status: 'dismissed', expectedStatus: 'proposed' } } }
  }
  if (current.status !== 'open') return movedOn()
  if (current.replies.some((reply) => !isAgentKind(reply.authorKind))) {
    return noWayBack('Somebody has answered in this thread, so taking the mark back would delete their answer.')
  }
  return { plan: { kind: 'delete' } }
}

function undoReply(row: AgentChangeRow, current: AnnotationView | undefined): UndoOutcome {
  const body = row.after?.body
  if (row.op !== 'create' || typeof body !== 'string') return noWayBack('This answer cannot be taken back.')
  const reply = current?.replies.find((candidate) => candidate.id === row.objectId)
  if (!reply || reply.body !== body) return movedOn()
  return { plan: { kind: 'delete-reply', replyId: reply.id, expectedBody: body } }
}

function undoUpdate(row: AgentChangeRow, current: AnnotationView | undefined): UndoOutcome {
  if (!current || !row.before || !row.after || !matchesState(current, row.after)) return movedOn()
  const before = row.before
  if ('status' in before && !canMoveBack(current, before.status)) {
    return noWayBack('This status change has no way back.')
  }
  const fields = Object.fromEntries(REVERTIBLE.filter((field) => field in before).map((field) => [field, before[field]]))
  const parsed = updateAnnotationRequestSchema.safeParse({ ...fields, expectedStatus: current.status })
  if (!parsed.success) return noWayBack('This change cannot be undone.')
  return { plan: { kind: 'revert', request: parsed.data } }
}

function undoDelete(row: AgentChangeRow, current: AnnotationView | undefined): UndoOutcome {
  if (current) return movedOn()
  const before = row.before ?? {}
  const { status, ...place } = before
  const mark = createAnnotationRequestSchema.safeParse(place)
  if (!mark.success || (status !== 'open' && status !== 'resolved')) {
    return noWayBack('This mark cannot be set again.')
  }
  return { plan: { kind: 'recreate', mark: mark.data, status } }
}

export function planUndo(row: AgentChangeRow, current: AnnotationView | undefined): UndoOutcome {
  if (row.objectKind === 'annotation_reply') return undoReply(row, current)
  switch (row.op) {
    case 'create':
      return undoCreate(row, current)
    case 'update':
      return undoUpdate(row, current)
    case 'delete':
      return undoDelete(row, current)
  }
}
