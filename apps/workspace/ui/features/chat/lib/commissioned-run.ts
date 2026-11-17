import type { ChatMessage } from '@/features/chat/types'
import { mapServerMessagesToChatMessages } from './server-message-mapper'

export async function fetchRunMessage(
  conversationId: string,
  messageId: string,
): Promise<ChatMessage | null> {
  try {
    const { conversationsClient } = await import('@/adapters/api/conversations-client')
    const messages = mapServerMessagesToChatMessages(
      await conversationsClient.listMessages(conversationId),
    )
    return messages.find((message) => message.id === messageId) ?? null
  } catch {
    return null
  }
}
