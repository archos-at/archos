import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

export const PROJECT_MEMORY_KINDS = [
  'decision',
  'constraint',
  'open_question',
  'derived_fact',
  'preference',
] as const
export type ProjectMemoryKind = (typeof PROJECT_MEMORY_KINDS)[number]

export const PROJECT_MEMORY_CONFIDENCES = ['low', 'medium', 'high'] as const
export type ProjectMemoryConfidence = (typeof PROJECT_MEMORY_CONFIDENCES)[number]

export const PROJECT_MEMORY_STATUSES = ['active', 'superseded', 'dismissed'] as const
export type ProjectMemoryStatus = (typeof PROJECT_MEMORY_STATUSES)[number]

export const PROJECT_MEMORY_LIFECYCLE = defineLifecycle<ProjectMemoryStatus, 'supersede' | 'dismiss' | 'restore'>({
  id: 'project-memory',
  initial: 'active',
  states: {
    active: { on: { supersede: 'superseded', dismiss: 'dismissed' } },
    superseded: { on: { restore: 'active' } },
    dismissed: { on: { restore: 'active' } },
  },
})

export const PROJECT_MEMORY_VERIFICATIONS = [
  'unverified',
  'source_grounded',
  'user_confirmed',
] as const
export type ProjectMemoryVerification = (typeof PROJECT_MEMORY_VERIFICATIONS)[number]
