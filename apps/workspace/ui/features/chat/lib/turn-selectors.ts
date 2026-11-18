import type { PendingInteraction } from '../types'
import type { TurnView } from '@/lib/turns/turn-fold'

export const runningTurnIn = (
  turns: Record<string, TurnView>,
  conversationId: string | undefined
): TurnView | undefined =>
  conversationId
    ? Object.values(turns).find((view) => view.conversationId === conversationId && view.phase === 'running')
    : undefined

export const turnStateFor = (
  turns: Record<string, TurnView>,
  conversationId: string | undefined
): { isStreaming: boolean; isLoading: boolean; pendingInteraction: PendingInteraction | null } => {
  const view = runningTurnIn(turns, conversationId)
  const request = view?.interaction
  return {
    isStreaming: Boolean(view && !request),
    isLoading: view?.lastSeq === 0,
    pendingInteraction: view && request
      ? { turnId: view.turnId, interactionId: request.interaction_id, input: request.input }
      : null,
  }
}
