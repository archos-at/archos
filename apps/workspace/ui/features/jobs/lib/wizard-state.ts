export const STEP_KEYS = ['task', 'schedule', 'review'] as const
export type StepKey = (typeof STEP_KEYS)[number]

export const SCHEDULE_STEP = STEP_KEYS.indexOf('schedule')

export interface WizardValues {
  name: string
  prompt: string
}
