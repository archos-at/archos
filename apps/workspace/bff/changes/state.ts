import type { AnnotationView } from '@/lib/annotations/types'
import type { ChangeState } from './types'

export const MARK_STATE_FIELDS = [
  'status',
  'kind',
  'body',
  'basis',
  'assigneeUserId',
  'dueOn',
  'page',
  'shape',
  'x',
  'y',
  'w',
  'h',
] as const satisfies readonly (keyof AnnotationView)[]
export type MarkStateField = (typeof MARK_STATE_FIELDS)[number]

type MarkLike = Pick<AnnotationView, MarkStateField>

export function fieldsOf(mark: MarkLike, fields: readonly MarkStateField[]): ChangeState {
  return Object.fromEntries(fields.map((field) => [field, mark[field]]))
}

export const markState = (mark: MarkLike): ChangeState => fieldsOf(mark, MARK_STATE_FIELDS)

export const replyState = (body: string): ChangeState => ({ body })

export function matchesState(current: Partial<Record<string, unknown>>, state: ChangeState): boolean {
  return Object.entries(state).every(([field, value]) => (current[field] ?? null) === (value ?? null))
}
