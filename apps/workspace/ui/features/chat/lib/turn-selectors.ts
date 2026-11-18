import type { PendingInteraction } from '../types'
import type { TurnView } from '@/lib/turns/turn-fold'

export const runningTurnIn = (
  turns: Record<string, TurnView>,
  conversationId: string | undefined
): TurnView | undefined =>
  conversationId
    ? Object.values(turns).find((view) => view.conversationId === conversationId && view.phase === 'running')
    : undefined

import type { UnseenEnd } from '@/lib/turns/conversation-activity'

export { conversationActivity, type ConversationActivity, type UnseenEnd } from '@/lib/turns/conversation-activity'

export const withUnseenAnswer = (
  state: { unseenAnswers: Record<string, UnseenEnd>; currentConversation: { id: string } | null },
  conversationId: string,
  end: UnseenEnd = 'answered'
): Record<string, UnseenEnd> => {
  const marked = state.unseenAnswers[conversationId]
  if (state.currentConversation?.id === conversationId || marked === end || marked === 'failed') return state.unseenAnswers
  return { ...state.unseenAnswers, [conversationId]: end }
}

export const withoutUnseenAnswer = (
  unseenAnswers: Record<string, UnseenEnd>,
  conversationId: string
): Record<string, UnseenEnd> => {
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
