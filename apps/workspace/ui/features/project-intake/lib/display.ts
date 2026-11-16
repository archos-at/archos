import { flattenIntakeQuestions } from '@/lib/project-profile/intake-conditions'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import type { ProjectIntakeQuestion } from '@/lib/project-profile/intake-types'
import { formatIntakeAnswer, labelForProfileKey } from '@/lib/project-profile/intake-vocabulary'
import type { ProjectPrimitiveValue } from '@/lib/project-profile/types'
import { OIB_EDITIONS } from '@/lib/project-experience/vocabulary'
import type { Need } from '@/lib/project-intake/types'

const WRITTEN_KEY = /^\/(?:facts|goals)\/([^/]+)/

let questionsByKey: Map<string, ProjectIntakeQuestion> | null = null

function questionFor(baseKey: string): ProjectIntakeQuestion | undefined {
  if (!questionsByKey) {
    questionsByKey = new Map()
    for (const question of flattenIntakeQuestions(projectIntakeDefinitionV1)) {
      const written = WRITTEN_KEY.exec(question.writesTo ?? '')?.[1]
      if (written && !questionsByKey.has(written)) questionsByKey.set(written, question)
    }
  }
  return questionsByKey.get(baseKey)
}

export const baseKeyOf = (key: string): string => key.split('@')[0]

export function questionForKey(key: string): ProjectIntakeQuestion | undefined {
  if (baseKeyOf(key) === 'oib_edition') return oibEditionQuestion(key)
  const question = questionFor(baseKeyOf(key))
  if (!question) return undefined
  const type = question.type === 'number_tri' ? 'number' : question.type === 'yes_no_open' ? 'boolean' : question.type
  return {
    id: key,
    label: question.label,
    type,
    ...(question.unit ? { unit: question.unit } : {}),
    ...(question.placeholder ? { placeholder: question.placeholder } : {}),
    ...(question.options ? { options: question.options } : {}),
  }
}

function oibEditionQuestion(key: string): ProjectIntakeQuestion {
  return {
    id: key,
    label: labelForProfileKey(projectIntakeDefinitionV1, key),
    type: 'single_select',
    options: OIB_EDITIONS.map((year) => ({ value: year, label: year })),
  }
}

export function displayValue(key: string, value: ProjectPrimitiveValue): string {
  const baseKey = baseKeyOf(key)
  if (baseKey === 'building_class') return `GK ${String(value)}`
  const question = questionFor(baseKey)
  return question ? formatIntakeAnswer(question, value) : String(value)
}

export const keyLabel = (key: string): string => labelForProfileKey(projectIntakeDefinitionV1, key)

export function buildingNumber(buildingId: string): string {
  return /\d+/.exec(buildingId)?.[0] ?? buildingId
}

export function questionOfNeed(need: Need): ProjectIntakeQuestion {
  const type = need.type === 'number_tri' ? 'number' : need.type === 'yes_no_open' ? 'boolean' : need.type
  return {
    id: need.key,
    label: need.label,
    type,
    ...(need.why ? { why: need.why } : {}),
    ...(need.unit ? { unit: need.unit } : {}),
    ...(need.options ? { options: need.options.map((option) => ({ value: option.token, label: option.label })) } : {}),
  }
}
