import type { ChatMessage } from '@/features/chat/types'
import { isAwaitingServerMessages } from '@/features/chat/stores/chat-storage'

export type ThreadPhase = 'hydrating' | 'loading' | 'empty' | 'thread'

export const isTransientConnectionError = (message: ChatMessage): boolean =>
  message.messageType === 'error' &&
  (message.errorData?.errorCode === 'connection.failed' ||
    message.errorData?.errorCode === 'connection.lost')

export const isDisplayableMessage = (message: ChatMessage): boolean => {
  const messageType = message.messageType || (message.role === 'user' ? 'user' : 'assistant')
  if (isTransientConnectionError(message)) return false
  return (
    messageType === 'user' ||
    messageType === 'prompt' ||
    messageType === 'agent_response' ||
    messageType === 'file' ||
    messageType === 'error'
  )
}

export interface ThreadPhaseInput {
  hasHydrated?: boolean
  currentConversation?: { id?: string; messages?: ChatMessage[] } | null
  pendingMessagesFor?: string | null
  serverConversationsLoaded?: boolean
}

export const selectThreadPhase = (state: ThreadPhaseInput): ThreadPhase => {
  if (state.hasHydrated === false) return 'hydrating'
  const conversation = state.currentConversation
  const pending = state.pendingMessagesFor ?? null
  if (pending !== null && pending !== conversation?.id) return 'loading'
  const shown = (conversation?.messages ?? []).some(isDisplayableMessage)
  if (shown) return 'thread'
  if (!conversation?.id) return 'empty'
  if (pending === conversation.id) return 'loading'
  if (
    state.serverConversationsLoaded === false &&
    (conversation.messages?.length ?? 0) === 0 &&
    isAwaitingServerMessages(conversation.id)
  ) {
    return 'loading'
  }
  return 'empty'
}
