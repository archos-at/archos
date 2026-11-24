import type { Conversation } from '../types'

export function ownProjectOf(
  { currentConversation, conversations }: { currentConversation: Conversation | null; conversations: readonly Conversation[] },
  conversationId: string
): string | undefined {
  const conversation =
    currentConversation?.id === conversationId
      ? currentConversation
      : conversations.find((candidate) => candidate.id === conversationId)
  return conversation?.projectId ?? undefined
}
