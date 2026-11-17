import type { TaskRunView } from '@/lib/tasks/task-wire'
import type { TaskRunStatus } from '@/lib/tasks/task-vocabulary'

export type { TaskRunSummary, TaskRunView } from '@/lib/tasks/task-wire'

const ACTIVE_STATUSES: ReadonlySet<TaskRunStatus> = new Set(['queued', 'running'])

const BROKEN_STATUSES: ReadonlySet<TaskRunStatus> = new Set(['failed', 'error'])

export function isActiveTask(task: TaskRunView): boolean {
  return ACTIVE_STATUSES.has(task.status)
}

export type TaskResultTarget = { kind: 'document' | 'conversation'; href: string } | null

function conversationQuery(task: TaskRunView): string {
  const session = `session=${encodeURIComponent(task.conversationId ?? '')}`
  if (!task.runMessageId) return session
  return `${session}&run=${encodeURIComponent(task.id)}#message-${encodeURIComponent(task.runMessageId)}`
}

export function taskThreadHref(projectId: string, task: TaskRunView): string | null {
  if (!task.conversationId) return null
  return `/app/projects/${encodeURIComponent(projectId)}/chat?${conversationQuery(task)}`
}

export function taskResultTarget(projectId: string, task: TaskRunView): TaskResultTarget {
  const project = encodeURIComponent(projectId)
  if (task.filedDocumentId) {
    return {
      kind: 'document',
      href: `/app/projects/${project}/files?doc=${encodeURIComponent(task.filedDocumentId)}`,
    }
  }
  const thread = taskThreadHref(projectId, task)
  return thread ? { kind: 'conversation', href: thread } : null
}

export const TASK_FILTERS = ['all', 'active', 'unreviewed', 'failed'] as const
export type TaskFilter = (typeof TASK_FILTERS)[number]

export function matchesFilter(task: TaskRunView, filter: TaskFilter): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'active':
      return isActiveTask(task)
    case 'unreviewed':
      return task.status === 'succeeded' && task.review === null
    case 'failed':
      return BROKEN_STATUSES.has(task.status)
  }
}

export function filterCounts(tasks: readonly TaskRunView[]): Record<TaskFilter, number> {
  const counts = { all: 0, active: 0, unreviewed: 0, failed: 0 }
  for (const task of tasks) {
    for (const filter of TASK_FILTERS) {
      if (matchesFilter(task, filter)) counts[filter] += 1
    }
  }
  return counts
}

export const TASK_BUCKETS = ['today', 'yesterday', 'week', 'earlier'] as const
export type TaskBucket = (typeof TASK_BUCKETS)[number]

export interface TaskGroup {
  bucket: TaskBucket
  tasks: TaskRunView[]
}

export function bucketFor(createdAt: string, now: Date): TaskBucket {
  const created = new Date(createdAt)
  if (Number.isNaN(created.getTime())) return 'earlier'
  const startOfToday = new Date(now)
  startOfToday.setHours(0, 0, 0, 0)
  if (created >= startOfToday) return 'today'
  const startOfYesterday = new Date(startOfToday)
  startOfYesterday.setDate(startOfYesterday.getDate() - 1)
  if (created >= startOfYesterday) return 'yesterday'
  const startOfWindow = new Date(startOfToday)
  startOfWindow.setDate(startOfWindow.getDate() - 7)
  return created >= startOfWindow ? 'week' : 'earlier'
}

export function groupByRecency(tasks: readonly TaskRunView[], now: Date = new Date()): TaskGroup[] {
  const groups = new Map<TaskBucket, TaskRunView[]>()
  for (const task of tasks) {
    const bucket = bucketFor(task.createdAt, now)
    const existing = groups.get(bucket)
    if (existing) existing.push(task)
    else groups.set(bucket, [task])
  }
  return TASK_BUCKETS.filter((bucket) => groups.has(bucket)).map((bucket) => ({
    bucket,
    tasks: groups.get(bucket) ?? [],
  }))
}
