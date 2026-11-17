import { RootSortRequestError } from '@/lib/filing/root-sort-client'
import {
  ROOT_SORT_WORKING_STATUSES,
  type RootSortRunStatus,
  type RootSortRunView,
  type RootSortSummary,
} from '@/lib/filing/root-sort-types'

export type WorkingRootSortStatus = 'judging' | 'grouping' | 'applying' | 'undoing'

export function isWorking(status: RootSortRunStatus): status is WorkingRootSortStatus {
  return ROOT_SORT_WORKING_STATUSES.includes(status)
}

export type RootSortPhase =
  | 'loading'
  | 'intro'
  | 'working'
  | 'review'
  | 'done'
  | 'undone'
  | 'failed'
  | 'cancelled'

export function phaseOf(
  summary: RootSortSummary | null,
  run: RootSortRunView | null,
  loadError: boolean
): RootSortPhase {
  if (loadError) return 'failed'
  const current = run ?? summary?.run ?? null
  if (current === null) return summary === null ? 'loading' : 'intro'
  if (isWorking(current.status)) return 'working'
  switch (current.status) {
    case 'ready':
      return 'review'
    case 'applied':
      return 'done'
    case 'undone':
      return 'undone'
    case 'cancelled':
      return 'cancelled'
    case 'failed':
      return 'failed'
  }
}

export function isSortConflict(error: unknown): boolean {
  return error instanceof RootSortRequestError && error.status === 409
}
