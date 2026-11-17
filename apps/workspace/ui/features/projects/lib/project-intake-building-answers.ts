import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'

export function withoutBuildingAnswers(
  answers: Record<string, ProjectPrimitiveValue>,
  buildingId: string
): Record<string, ProjectPrimitiveValue> {
  const next: Record<string, ProjectPrimitiveValue> = {}
  for (const [key, value] of Object.entries(answers)) {
    if (!key.includes(`@${buildingId}`)) next[key] = value
  }
  return next
}
