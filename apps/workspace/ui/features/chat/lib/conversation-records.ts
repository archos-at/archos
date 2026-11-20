import { v4 as uuidv4 } from 'uuid'
import type { ChatStore, Conversation } from '../types'

export const generateTitle = (content: string): string => {
  const maxLength = 50
  const trimmed = content.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return trimmed.substring(0, maxLength) + '...'
}

export const updateConversationInList = (
  conversations: Conversation[],
  updatedConversation: Conversation
): Conversation[] => {
  return conversations.map((c) => (c.id === updatedConversation.id ? updatedConversation : c))
}

export const withConversation = (
  state: Pick<ChatStore, 'conversations' | 'currentConversation'>,
  conversation: Conversation
) => {
  const { conversations, currentConversation } = state
  return {
    conversations: updateConversationInList(conversations, conversation),
    ...(currentConversation?.id === conversation.id && { currentConversation: conversation }),
  }
}

export const createNewConversation = (userId: string): Conversation => ({
  id: `s_${uuidv4().replace(/-/g, '_')}`,
  userId,
  title: '',
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
})
