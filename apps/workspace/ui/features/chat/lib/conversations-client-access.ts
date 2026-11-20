let conversationsClientModule: Promise<
  typeof import('@/adapters/api/conversations-client')
> | null = null

export const isRightsLost = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConversationRightsLostError'

export const getConversationsClient = () => {
  conversationsClientModule ??= import('@/adapters/api/conversations-client')
  return conversationsClientModule.then((m) => m.conversationsClient)
}
