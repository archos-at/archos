import type { ProjectPrimitiveValue } from './types'
import { BUILDING_ID_IN_ANSWER_KEY, BUILDING_NAME_ANSWER_PREFIX, type BuildingInstance, answerKeyFor, buildingNumber, defaultBuildings, modeKeyFor, scopeOfQuestion } from './intake-building-keys'
import { projectIntakeDefinitionV1 } from './intake-definition'
import type { ProjectIntakeCondition, ProjectIntakeDefinition, ProjectIntakeQuestion } from './intake-types'

export const FEDERAL_STATE_TOKENS: readonly string[] = (() => {
  const question = flattenIntakeQuestions(projectIntakeDefinitionV1).find((q) => q.id === 'A2_land')
  return question?.options?.map((option) => option.value) ?? []
})()

export function isValidFederalStateToken(token: string): boolean {
  return FEDERAL_STATE_TOKENS.includes(token)
}

export const COUNTRY_TOKENS: readonly string[] = (() => {
  const question = flattenIntakeQuestions(projectIntakeDefinitionV1).find(
    (q) => q.id === 'A2_country'
  )
  return question?.options?.map((option) => option.value) ?? []
})()

export function isValidCountryToken(token: string): boolean {
  return COUNTRY_TOKENS.includes(token)
}

export function evaluateIntakeCondition(
  question: ProjectIntakeQuestion,
  answers: Record<string, ProjectPrimitiveValue>,
  instanceId?: string
): boolean {
  return evaluateIntakeConditions(question.conditions, answers, instanceId)
}

export function evaluateIntakeConditions(
  conditions: ProjectIntakeCondition[] | undefined,
  answers: Record<string, ProjectPrimitiveValue>,
  instanceId?: string
): boolean {
  if (!conditions || conditions.length === 0) return true
  return conditions.every((cond) => evaluateSingleCondition(cond, answers, instanceId))
}

function answerIncludesAny(
  answer: ProjectPrimitiveValue | undefined,
  value: ProjectIntakeCondition['value']
): boolean {
  const needles = Array.isArray(value) ? value : value !== undefined ? [String(value)] : []
  if (Array.isArray(answer)) return answer.some((v) => needles.includes(String(v)))
  return typeof answer === 'string' && needles.includes(answer)
}

function evaluateSingleCondition(
  cond: ProjectIntakeCondition,
  answers: Record<string, ProjectPrimitiveValue>,
  instanceId?: string
): boolean {
  const paramScope = scopeOfQuestion(cond.param)
  const key = paramScope === 'building' && instanceId ? `${cond.param}@${instanceId}` : cond.param
  const answer = answers[key]

  switch (cond.op) {
    case 'not_empty':
      return isIntakeAnswerProvided(answer)
    case 'includes_any':
      return answerIncludesAny(answer, cond.value)
    case 'excludes_any':
      return !answerIncludesAny(answer, cond.value)
    case 'lte': {
      if (!isIntakeAnswerProvided(answer)) return false
      if (answers[modeKeyFor(key)] === 'open') return false
      const numeric = typeof answer === 'number' ? answer : Number(answer)
      return typeof cond.value === 'number' && Number.isFinite(numeric) && numeric <= cond.value
    }
    case 'equals':
    default: {
      if (Array.isArray(answer))
        return cond.value !== undefined && answer.includes(cond.value as string)
      return answer === cond.value
    }
  }
}

export function flattenIntakeQuestions(
  definition: ProjectIntakeDefinition
): ProjectIntakeQuestion[] {
  const out: ProjectIntakeQuestion[] = []
  for (const stage of definition.stages) {
    out.push(...stage.questions)
    if (stage.zoneCommon) out.push(...stage.zoneCommon)
    for (const def of Object.values(stage.zoneDefinitions ?? {})) out.push(...def.questions)
  }
  return out
}

export function findIntakeQuestion(
  definition: ProjectIntakeDefinition,
  questionId: string
): ProjectIntakeQuestion | undefined {
  return flattenIntakeQuestions(definition).find((q) => q.id === questionId)
}

export function buildingsFromAnswers(
  answers: Record<string, ProjectPrimitiveValue>
): BuildingInstance[] {
  const ids = new Set<string>()
  for (const key of Object.keys(answers)) {
    const match = key.match(BUILDING_ID_IN_ANSWER_KEY)
    if (match) ids.add(match[1])
  }
  const sorted = [...ids].sort((a, b) => buildingNumber(a) - buildingNumber(b))
  if (sorted.length === 0) return defaultBuildings()
  return sorted.map((id, i) => {
    const stored = answers[`${BUILDING_NAME_ANSWER_PREFIX}${id}`]
    return { id, name: typeof stored === 'string' && stored ? stored : `Bauwerk ${i + 1}` }
  })
}

export function pruneStaleConditionalAnswers(
  answers: Record<string, ProjectPrimitiveValue>,
  definition: ProjectIntakeDefinition | null | undefined
): Record<string, ProjectPrimitiveValue> {
  if (!definition) return answers
  const buildings = buildingsFromAnswers(answers)
  let current = answers
  let changedAny = false

  for (;;) {
    let changedThisPass = false
    let next: Record<string, ProjectPrimitiveValue> | null = null

    const dropIfOrphaned = (
      question: ProjectIntakeQuestion,
      answerKey: string,
      instanceId?: string
    ) => {
      if (!question.conditions || question.conditions.length === 0) return
      const hasAnswer = answerKey in current || modeKeyFor(answerKey) in current
      if (!hasAnswer) return
      if (evaluateIntakeCondition(question, current, instanceId)) return
      if (!next) next = { ...current }
      delete next[answerKey]
      delete next[modeKeyFor(answerKey)]
      changedThisPass = true
    }

    for (const stage of definition.stages) {
      if (stage.scope === 'building') {
        for (const building of buildings) {
          for (const q of stage.questions) dropIfOrphaned(q, answerKeyFor(q.id, building.id), building.id)
        }
      } else {
        for (const q of stage.questions) dropIfOrphaned(q, q.id)
      }
    }

    if (!changedThisPass) break
    if (next) current = next
    changedAny = true
  }

  return changedAny ? current : answers
}

export function isIntakeAnswerProvided(answer: ProjectPrimitiveValue | undefined): boolean {
  if (answer === undefined || answer === null || answer === '') return false
  if (Array.isArray(answer)) return answer.length > 0
  return true
}

export interface WriteTarget {
  scope: 'facts' | 'goals'
  key: string
}
