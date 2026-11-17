import { answerKeyFor } from './intake-building-keys'
import {
  buildingsFromAnswers,
  evaluateIntakeCondition,
  flattenIntakeQuestions,
  isIntakeAnswerProvided,
} from './intake-conditions'
import { projectIntakeDefinitionV1 } from './intake-definition'
import { answersFromProfile } from './intake-profile'
import { formatIntakeAnswer } from './intake-vocabulary'
import type { ProjectIntakeDefinition, ProjectIntakeQuestion } from './intake-types'
import type { ProjectPrimitiveValue, ProjectProfile } from './types'

export type ConsistencySeverity = 'warning' | 'inconsistency'

export interface DeterministicConsistencyFinding {
  kind: 'deterministic'
  fields: string[]
  severity: ConsistencySeverity
  messageKey: string
  params?: Record<string, string | number>
}

export interface AiConsistencyFinding {
  kind: 'ai'
  fields: string[]
  severity: ConsistencySeverity
  message: string
}

export type ConsistencyFinding = DeterministicConsistencyFinding | AiConsistencyFinding

export interface ConsistencyCheckField {
  field: string
  value: string
}

type Answers = Record<string, ProjectPrimitiveValue>

function questionById(
  definition: ProjectIntakeDefinition,
  id: string
): ProjectIntakeQuestion | undefined {
  return flattenIntakeQuestions(definition).find((q) => q.id === id)
}

function labelFor(definition: ProjectIntakeDefinition, id: string): string {
  return questionById(definition, id)?.label ?? id
}

function checkFossilNewBuildConflict(
  answers: Answers,
  definition: ProjectIntakeDefinition
): DeterministicConsistencyFinding[] {
  const plannedWork = answers['A5']
  const isNewBuild = Array.isArray(plannedWork) && plannedWork.includes('new_build')
  if (!isNewBuild) return []

  const findings: DeterministicConsistencyFinding[] = []
  for (const building of buildingsFromAnswers(answers)) {
    if (answers[answerKeyFor('E1', building.id)] === 'gas') {
      findings.push({
        kind: 'deterministic',
        fields: [labelFor(definition, 'A5'), `${building.name} · ${labelFor(definition, 'E1')}`],
        severity: 'inconsistency',
        messageKey: 'fossilNewBuildConflict',
        params: { building: building.name },
      })
    }
  }
  return findings
}

export function checkIntakeConsistencyFromAnswers(
  answers: Answers,
  definition: ProjectIntakeDefinition = projectIntakeDefinitionV1
): DeterministicConsistencyFinding[] {
  return [...checkFossilNewBuildConflict(answers, definition)]
}

export function checkIntakeConsistency(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition = projectIntakeDefinitionV1
): DeterministicConsistencyFinding[] {
  const { answers } = answersFromProfile(profile, definition)
  return checkIntakeConsistencyFromAnswers(answers, definition)
}

function isFreeText(question: ProjectIntakeQuestion): boolean {
  return question.type === 'text' || question.type === 'textarea'
}

export function collectFreeTextFields(
  answers: Answers,
  definition: ProjectIntakeDefinition = projectIntakeDefinitionV1,
  minLength = 10
): ConsistencyCheckField[] {
  const fields: ConsistencyCheckField[] = []
  for (const stage of definition.stages) {
    if (stage.scope === 'building') continue
    for (const question of stage.questions) {
      if (!isFreeText(question)) continue
      if (!evaluateIntakeCondition(question, answers)) continue
      const raw = answers[question.id]
      const value = typeof raw === 'string' ? raw.trim() : ''
      if (value.length < minLength) continue
      fields.push({ field: question.label, value })
    }
  }
  return fields
}

export function collectStructuredContextFields(
  answers: Answers,
  definition: ProjectIntakeDefinition = projectIntakeDefinitionV1
): ConsistencyCheckField[] {
  const fields: ConsistencyCheckField[] = []
  for (const stage of definition.stages) {
    if (stage.scope === 'building') continue
    for (const question of stage.questions) {
      if (
        isFreeText(question) ||
        question.type === 'info_placeholder' ||
        question.type === 'upload' ||
        question.type === 'document_role'
      )
        continue
      if (!evaluateIntakeCondition(question, answers)) continue
      const raw = answers[question.id]
      if (!isIntakeAnswerProvided(raw)) continue
      fields.push({ field: question.label, value: formatIntakeAnswer(question, raw) })
    }
  }
  return fields
}
