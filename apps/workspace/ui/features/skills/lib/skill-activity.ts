import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'

export type SkillActivityPhase = 'offered' | 'activated' | 'loaded'

export interface SkillActivity {
  phase: SkillActivityPhase
  name?: string
  title?: string
  hidden: boolean
}

const PHASES: readonly string[] = ['offered', 'activated', 'loaded']

export const skillActivityOf = (
  step: Pick<StoredThinkingStep, 'kind' | 'skill' | 'detail'>
): SkillActivity | null => {
  if (step.kind !== 'skill') return null
  const { phase, hidden, title } = step.detail ?? {}
  if (typeof phase !== 'string' || !PHASES.includes(phase)) return null
  return {
    phase: phase as SkillActivityPhase,
    ...(step.skill ? { name: step.skill } : {}),
    ...(typeof title === 'string' && title ? { title } : {}),
    hidden: hidden === true,
  }
}

export interface SkillLabel {
  text: string
  mono: boolean
}

export const skillLabel = (
  skill: { name?: string | null; title?: string | null } | null | undefined
): SkillLabel | null => {
  const title = skill?.title?.trim()
  if (title) return { text: title, mono: false }
  const name = skill?.name?.trim()
  if (name) return { text: name, mono: true }
  return null
}
