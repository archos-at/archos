import type { ChatMessage } from '../types'

const MEANINGFUL_MESSAGE_TYPES = new Set(['user', 'assistant', 'agent_response', 'error', 'prompt'])

export const ownsUnansweredTurnIn = (
  messages: ChatMessage[] | undefined,
  currentUserId: string | null
): boolean => {
  if (!messages?.length) return false
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (!MEANINGFUL_MESSAGE_TYPES.has(message.messageType ?? '')) continue
    if (message.messageType === 'prompt') return !message.isPromptResponded
    if (message.messageType === 'user') {
      return !message.authorUserId || message.authorUserId === currentUserId
    }
    return message.isStreaming === true
  }
  return false
}
