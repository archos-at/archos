import type { SkillReviewField } from '../hooks/use-skill-review'

export const STEP_KEYS = ['what', 'instructions', 'check'] as const
export type StepKey = (typeof STEP_KEYS)[number]

export const STEP_FOR_FIELD: Record<SkillReviewField, StepKey> = {
  name: 'what',
  description: 'what',
  body: 'instructions',
}

export const CONTROL_ID: Record<SkillReviewField, string> = {
  name: 'name',
  description: 'description',
  body: 'skill-body',
}
