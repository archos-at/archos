import { evaluateIntakeCondition } from '@/lib/project-profile/intake-conditions'
import type { ProjectIntakeQuestion, ProjectIntakeStage } from '@/lib/project-profile/intake-types'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'

export function visibleStageQuestions(
  stage: ProjectIntakeStage,
  answers: Record<string, ProjectPrimitiveValue>
): ProjectIntakeQuestion[] {
  return stage.questions.filter((q) => evaluateIntakeCondition(q, answers))
}

export function quickStartQuestions(questions: ProjectIntakeQuestion[]): ProjectIntakeQuestion[] {
  return questions.filter((q) => q.core || q.required)
}
