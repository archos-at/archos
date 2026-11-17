import type { AgentChangeView } from '@/lib/changes/types'
import type { CanvasActivityItem, LiveMark } from './canvas-activity'

const queueKey = (objectKind: string, op: string, annotationId: string): string =>
  `${objectKind}:${op}:${annotationId}`

export function matchChanges(
  items: readonly CanvasActivityItem[],
  changes: readonly AgentChangeView[] | null
): ReadonlyMap<number, AgentChangeView> {
  const matched = new Map<number, AgentChangeView>()
  if (!changes || changes.length === 0) return matched

  const queues = new Map<string, AgentChangeView[]>()
  for (const change of changes) {
    const key = queueKey(change.objectKind, change.op, change.annotationId)
    queues.set(key, [...(queues.get(key) ?? []), change])
  }
  const deletions = changes.filter((change) => change.objectKind === 'annotation' && change.op === 'delete')
  const deletedRows = items.filter((item) => item.action === 'deleted').length

  let nextDeletion = 0
  items.forEach((item, index) => {
    let change: AgentChangeView | undefined
    if (item.action === 'proposed' || item.action === 'created') {
      change = queues.get(queueKey('annotation', 'create', item.annotation_id))?.shift()
    } else if (item.action === 'changed') {
      change = queues.get(queueKey('annotation', 'update', item.annotation_id))?.shift()
    } else if (item.action === 'replied') {
      change = queues.get(queueKey('annotation_reply', 'create', item.annotation_id))?.shift()
    } else if (deletions.length === deletedRows) {
      change = deletions[nextDeletion++]
    }
    if (change) matched.set(index, change)
  })
  return matched
}

export function standsAsChanged(change: AgentChangeView, live: LiveMark): boolean {
  const after = change.after
  if (!after) return true
  const same = (key: string, value: unknown) => !(key in after) || (after[key] ?? null) === (value ?? null)
  return (
    same('status', live.status) &&
    same('body', live.body) &&
    same('kind', live.kind) &&
    same('assigneeUserId', live.assigneeUserId) &&
    same('dueDate', live.dueOn)
  )
}
