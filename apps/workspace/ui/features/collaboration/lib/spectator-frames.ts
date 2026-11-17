import type { WireEvent } from '@/adapters/api/wire-v2'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { foldTurnEvent, type TurnView } from '@/lib/turns/turn-fold'
import { ACTING_CARD_TYPES } from '@/features/cards/card-decision'
import { SYSTEM_CARD_TYPES } from '@/features/skills/lib/card-catalog'
import { validateAnswerCards, type AnswerCard } from '@/shared/cards/schemas'

export function foldSpectatedEvent(view: TurnView | null, event: WireEvent): TurnView | null {
  if (event.seq === 0) return view
  if (!view || view.turnId !== event.turn_id) return foldTurnEvent(undefined, event)
  const next = foldTurnEvent(view, event)
  return next.gap ? foldTurnEvent({ ...view, lastSeq: event.seq - 1 }, event) : next
}

export const hasSomethingToShow = (view: TurnView): boolean =>
  Boolean(view.text || view.answerMeta || view.interaction || view.stepOrder.length > 0) ||
  (observerCards(view)?.some((card) => card !== undefined) ?? false)

export const orderedSteps = (view: TurnView): StoredThinkingStep[] => view.stepOrder.map((id) => view.steps[id])

const NOT_FOR_OBSERVERS: ReadonlySet<string> = new Set<string>([...ACTING_CARD_TYPES, ...SYSTEM_CARD_TYPES])

export function observerCards(view: TurnView): (AnswerCard | undefined)[] | undefined {
  if (view.cards.length === 0) return undefined
  return Array.from(view.cards, (keyed) => {
    const card = keyed ? validateAnswerCards([keyed.card])[0] : undefined
    return card && !NOT_FOR_OBSERVERS.has(card.type) ? card : undefined
  })
}
