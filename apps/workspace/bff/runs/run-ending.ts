import type { TaskRun } from '@/lib/db/schema/task-model'
import type { RunEnding } from './service'

export function endingOfClosedRun(run: Pick<TaskRun, 'status' | 'error'>): RunEnding {
  if (run.status === 'succeeded') return { status: 'success' }
  if (run.status === 'interrupted') return { status: 'interrupted' }
  return { status: 'failure', error: run.error }
}
