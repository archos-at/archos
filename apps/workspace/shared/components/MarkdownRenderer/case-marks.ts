import { useCasesDecision } from './project-binding'

export function useCaseMarks(properties: Record<string, unknown> | undefined): { active: boolean; muted: boolean } {
  const cases = useCasesDecision()
  const index = properties?.dataCaseIndex
  if (cases && index !== undefined) {
    const active = Number(index) === cases.match
    return { active, muted: cases.match >= 0 && !active }
  }
  return { active: Boolean(properties?.dataActive), muted: Boolean(properties?.dataMuted) }
}
