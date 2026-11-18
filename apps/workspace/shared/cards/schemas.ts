import { z } from 'zod'
import { answerCardSchema, projectProfilePatchCardSchema, type CalculationStepData, type DimensionCheckData } from './generated'
import { modernizeAnswerCard } from './legacy'

export { answerCardSchema, projectProfilePatchCardSchema }
export type * from './generated'

export type AnswerCard = z.infer<typeof answerCardSchema>

export type DimStatus = DimensionCheckData['status']
export type Provenance = NonNullable<DimensionCheckData['provenance']>
export type CalculationOperation = CalculationStepData['operation']

export function validateAnswerCards(raw: unknown): (AnswerCard | undefined)[] {
  if (!Array.isArray(raw)) return []
  return raw.map((item) => {
    const result = answerCardSchema.safeParse(modernizeAnswerCard(item))
    if (result.success) {
      return result.data
    }
    const cardType =
      typeof item === 'object' && item !== null && 'type' in item ? (item as { type: unknown }).type : 'unknown'
    console.warn('[AnswerCards] Dropping card that failed schema validation', cardType, result.error.issues)
    return undefined
  })
}
