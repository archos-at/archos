import type { PendingInteraction } from '../types'
import type { TurnView } from '@/lib/turns/turn-fold'

export const runningTurnIn = (
  turns: Record<string, TurnView>,
  conversationId: string | undefined
): TurnView | undefined =>
  conversationId
    ? Object.values(turns).find((view) => view.conversationId === conversationId && view.phase === 'running')
    : undefined

export type ConversationActivity = 'working' | 'waiting' | 'answered'

export const conversationActivity = (
  turns: Record<string, TurnView>,
  unseenAnswers: Record<string, true>,
  conversationId: string
): ConversationActivity | null => {
  const view = runningTurnIn(turns, conversationId)
  if (view) return view.interaction ? 'waiting' : 'working'
  return unseenAnswers[conversationId] ? 'answered' : null
}

export const withUnseenAnswer = (
  state: { unseenAnswers: Record<string, true>; currentConversation: { id: string } | null },
  conversationId: string
): Record<string, true> =>
  state.currentConversation?.id === conversationId || state.unseenAnswers[conversationId]
    ? state.unseenAnswers
    : { ...state.unseenAnswers, [conversationId]: true }

export const withoutUnseenAnswer = (
  unseenAnswers: Record<string, true>,
  conversationId: string
): Record<string, true> => {
  if (!unseenAnswers[conversationId]) return unseenAnswers
  const { [conversationId]: _seen, ...rest } = unseenAnswers
  return rest
}

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
