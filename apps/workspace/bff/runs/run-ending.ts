/**
 * The ending a closed `task_runs` row records, as its block is told it.
 *
 * Its own module because both sides of the pair need it: the outcome recorder
 * (`lib/tasks/service.ts`) settles the block with the ending the row holds,
 * and the reconciler's heal (`./reconcile`) does the same for a closed run
 * nothing has looked at since. `./reconcile` imports the recorder, so the
 * recorder cannot import this from there.
 */

import type { TaskRun } from '@/lib/db/schema/task-model'
import type { RunEnding } from './service'

/**
 * The row is the authority: its ending was chosen by the one compare-and-set
 * that closes a run (`closeActiveRun`), whoever reported it.
 */
export function endingOfClosedRun(run: Pick<TaskRun, 'status' | 'error'>): RunEnding {
  if (run.status === 'succeeded') return { status: 'success' }
  if (run.status === 'interrupted') return { status: 'interrupted' }
  return { status: 'failure', error: run.error }
}
