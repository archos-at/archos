import { projectIntakeDefinitionV1 } from './intake-definition'
import type { ProjectIntakeScope } from './intake-types'

export const BUILDING_ID_PREFIX = 'bldg'

export const BUILDING_ID_IN_KEY = new RegExp(`@(${BUILDING_ID_PREFIX}\\d+)(?:@|$)`)

export const BUILDING_ID_IN_ANSWER_KEY = new RegExp(`@(${BUILDING_ID_PREFIX}\\d+)(?:@|$|__)`)

export function buildingNumber(id: string): number {
  return Number(id.slice(BUILDING_ID_PREFIX.length))
}

const BUILDING_ID = new RegExp(`^${BUILDING_ID_PREFIX}[1-9]\\d*$`)

export function isBuildingId(id: string): boolean {
  return BUILDING_ID.test(id)
}

export function buildingTag(id: string): string {
  return `BW${buildingNumber(id)}`
}

export interface BuildingInstance {
  id: string
  name: string
}

export function defaultBuildings(): BuildingInstance[] {
  return [{ id: `${BUILDING_ID_PREFIX}1`, name: 'Bauwerk 1' }]
}

export function answerKeyFor(questionId: string, buildingId?: string, zoneKey?: string): string {
  let key = questionId
  if (buildingId) key += `@${buildingId}`
  if (zoneKey) key += `@${zoneKey}`
  return key
}

export function buildingIdFromAnswerKey(answerKey: string): string | null {
  const [, buildingId] = answerKey.split('@')
  return buildingId ?? null
}

export const BUILDING_NAME_ANSWER_PREFIX = '__building_name@'

export function modeKeyFor(answerKey: string): string {
  return `${answerKey}__mode`
}

export function scopeOfQuestion(questionId: string): ProjectIntakeScope | null {
  for (const stage of projectIntakeDefinitionV1.stages) {
    if (stage.questions.some((q) => q.id === questionId)) return stage.scope
    if (stage.zoneCommon?.some((q) => q.id === questionId)) return 'building'
    for (const def of Object.values(stage.zoneDefinitions ?? {})) {
      if (def.questions.some((q) => q.id === questionId)) return 'building'
    }
  }
  return null
}
