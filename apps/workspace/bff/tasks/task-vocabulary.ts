import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'
import { DELEGATABLE_TASK_KINDS } from '@/shared/vocabularies.generated'

export { DELEGATABLE_TASK_KINDS }

export const TASK_KINDS = ['deep-research', 'chat', ...DELEGATABLE_TASK_KINDS] as const
export type TaskKind = (typeof TASK_KINDS)[number]

export const LEGACY_TASK_KINDS: Readonly<Record<string, TaskKind>> = {
  einreichcheck: 'submission_check',
}

export const canonicalTaskKind = (value: unknown): unknown =>
  typeof value === 'string' ? (LEGACY_TASK_KINDS[value] ?? value) : value

export const TASK_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'interrupted'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export const DEFINITION_TRIGGERS = ['manual', 'once', 'schedule'] as const
export type DefinitionTrigger = (typeof DEFINITION_TRIGGERS)[number]

export const TASK_RUN_TRIGGERS = ['manual', 'schedule', 'delegated'] as const
export type TaskRunTrigger = (typeof TASK_RUN_TRIGGERS)[number]

export const TASK_RUN_STATUSES = [
  'queued',
  'running',
  'succeeded',
  'failed',
  'interrupted',
  'skipped',
  'error',
] as const
export type TaskRunStatus = (typeof TASK_RUN_STATUSES)[number]

export const TASK_RUN_LIFECYCLE = defineLifecycle<TaskRunStatus, 'start' | 'succeed' | 'fail' | 'interrupt'>({
  id: 'task-run',
  initial: 'queued',
  bornAs: ['running', 'skipped', 'error'],
  states: {
    queued: { on: { start: 'running', succeed: 'succeeded', fail: 'failed', interrupt: 'interrupted' } },
    running: { on: { succeed: 'succeeded', fail: 'failed', interrupt: 'interrupted' } },
    succeeded: { type: 'final' },
    failed: { type: 'final' },
    interrupted: { type: 'final' },
    skipped: { type: 'final' },
    error: { type: 'final' },
  },
})

export function isActiveTaskRunStatus(status: TaskRunStatus): boolean {
  return TASK_RUN_LIFECYCLE.liveStates.includes(status)
}

export function submittedRunStatus(submitted: {
  queued: boolean
  runMessageId: string | null
}): 'queued' | 'running' {
  return submitted.queued && submitted.runMessageId ? 'queued' : 'running'
}

export const TASK_REVIEWS = ['accepted', 'rejected'] as const
export type TaskReview = (typeof TASK_REVIEWS)[number]
