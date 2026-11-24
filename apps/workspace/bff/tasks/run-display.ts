import type { TaskRunStatus } from './task-vocabulary'
import type { TaskRunView } from './task-wire'

export const RUN_STATUS_VARIANT: Record<TaskRunStatus, 'info' | 'success' | 'destructive' | 'secondary' | 'warning'> = {
  queued: 'info',
  running: 'info',
  succeeded: 'success',
  failed: 'destructive',
  interrupted: 'secondary',
  skipped: 'warning',
  error: 'destructive',
}

const BROKEN_STATUSES: ReadonlySet<TaskRunStatus> = new Set(['failed', 'error'])

export function isBrokenRunStatus(status: TaskRunStatus): boolean {
  return BROKEN_STATUSES.has(status)
}

type ThreadedRun = Pick<TaskRunView, 'id' | 'conversationId' | 'runMessageId'>

function conversationQuery(run: ThreadedRun): string {
  const session = `session=${encodeURIComponent(run.conversationId ?? '')}`
  if (!run.runMessageId) return session
  return `${session}&run=${encodeURIComponent(run.id)}#message-${encodeURIComponent(run.runMessageId)}`
}

export function runThreadHref(projectId: string, run: ThreadedRun): string | null {
  if (!run.conversationId) return null
  return `/app/projects/${encodeURIComponent(projectId)}/chat?${conversationQuery(run)}`
}
