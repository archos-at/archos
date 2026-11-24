const erased = new Set<string>()

export function markConversationErased(conversationId: string): void {
  erased.add(conversationId)
}

export function isConversationErased(conversationId: string): boolean {
  return erased.has(conversationId)
}

export function resetErasedConversations(): void {
  erased.clear()
}
