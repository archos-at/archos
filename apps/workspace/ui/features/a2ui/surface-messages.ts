import type { A2uiMessage } from '@a2ui/web_core/v0_9'

import type { AnswerCard } from '@/shared/cards/schemas'
import { answerCardSchema } from '@/shared/cards/schemas'
import { modernizeAnswerCard } from '@/shared/cards/legacy'
import { cardTypeOf, CARDS_CATALOG_ID, SURFACE_EXCLUDED_LEAVES, TEXT_COMPONENT } from './catalog'

const CARD_TYPES: ReadonlySet<string> = new Set(answerCardSchema.options.map(cardTypeOf))

type SurfaceCard = Extract<AnswerCard, { type: 'surface' }>

export function surfaceComponents(card: AnswerCard): Record<string, unknown>[] {
  if (card.type === 'surface') return (card as SurfaceCard).components
  const { type, ...props } = card
  return [{ id: 'root', component: type, ...props }]
}

export function cardToSurfaceMessages(card: AnswerCard, surfaceId: string): A2uiMessage[] {
  return [
    { version: 'v0.9', createSurface: { surfaceId, catalogId: CARDS_CATALOG_ID } },
    { version: 'v0.9', updateComponents: { surfaceId, components: surfaceComponents(card) } },
  ] as A2uiMessage[]
}

export interface TextLeaf {
  text: string
}

export interface SurfaceLeaf {
  id: string
  leaf: AnswerCard | TextLeaf
}

export function surfaceLeaves(card: AnswerCard): SurfaceLeaf[] {
  return surfaceComponents(card).flatMap(({ id, component, ...props }): SurfaceLeaf[] => {
    const leafId = String(id)
    if (component === TEXT_COMPONENT && typeof props.text === 'string') return [{ id: leafId, leaf: { text: props.text } }]
    const type = String(component)
    if (!CARD_TYPES.has(type) || SURFACE_EXCLUDED_LEAVES.has(type)) return []
    const result = answerCardSchema.safeParse(modernizeAnswerCard({ ...props, type }))
    if (result.success) return [{ id: leafId, leaf: result.data }]
    console.warn('[AnswerCards] Dropping surface leaf that failed schema validation', type, leafId, result.error.issues)
    return []
  })
}
