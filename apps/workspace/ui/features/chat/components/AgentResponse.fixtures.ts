import type { AnswerCard } from '@/shared/cards/schemas'
import { CARD_PREVIEW_FIXTURES } from '@/features/cards/preview-fixtures'

export const calculationCard = (title: string): AnswerCard => ({ ...CARD_PREVIEW_FIXTURES.calculation!, title } as AnswerCard)
