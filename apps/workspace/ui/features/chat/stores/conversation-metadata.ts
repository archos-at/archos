import type { StateCreator } from 'zustand'
import type { ChatMessage, ChatStore, Conversation } from '../types'
import type { SessionsSlice } from './sessions-store'
import { getActiveLocale } from '@/i18n'
import { updateConversationInList } from '../lib/conversation-updates'
import { getConversationsClient } from '../lib/conversations-client-access'

const namedConversations = new Set<string>()

const messagePlainText = (message: ChatMessage): string => (message.content ?? '').trim()

export const createConversationMetadataSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  Pick<
    SessionsSlice,
    | 'updateConversationTitle'
    | 'maybeGenerateConversationName'
    | 'saveDataSourcesToConversation'
  >
> = (set, get) => ({
  updateConversationTitle: (conversationId: string, title: string) => {
    const { currentConversation, conversations } = get()

    const updatedConversations = conversations.map((c) =>
      c.id === conversationId ? { ...c, title, updatedAt: new Date() } : c
    )

    const updatedCurrentConversation =
      currentConversation?.id === conversationId
        ? { ...currentConversation, title, updatedAt: new Date() }
        : currentConversation

    set(
      {
        conversations: updatedConversations,
        currentConversation: updatedCurrentConversation,
      },
      false,
      'updateConversationTitle'
    )

    getConversationsClient().then((conversationsClient) => {
      conversationsClient.updateTitle(conversationId, title).catch((err) => {
        console.warn('[updateConversationTitle] Failed to sync title to server:', err)
      })
    })
  },

  maybeGenerateConversationName: (conversationId: string) => {
    if (namedConversations.has(conversationId)) return

    const { conversations } = get()
    const conversation = conversations.find((c) => c.id === conversationId)
    if (!conversation) return

    const hasRun = conversation.messages.some((m) => Boolean(m.runLedger || m.deepResearchJobId))
    if (hasRun) return

    const userMessages = conversation.messages.filter((m) => m.messageType === 'user')
    if (userMessages.length !== 1) return

    const firstQuestion = messagePlainText(userMessages[0])
    if (!firstQuestion) return

    const firstAnswer = conversation.messages.find(
      (m) => m.messageType === 'agent_response' && messagePlainText(m).length > 0
    )
    if (!firstAnswer) return

    namedConversations.add(conversationId)

    const payload = [
      { role: 'user' as const, content: firstQuestion },
      { role: 'assistant' as const, content: messagePlainText(firstAnswer) },
    ]

    getConversationsClient()
      .then((conversationsClient) =>
        conversationsClient.generateTitle(conversationId, payload, getActiveLocale())
      )
      .then((result) => {
        const title = result.title.trim()
        if (!title) {
          namedConversations.delete(conversationId)
          return
        }
        get().updateConversationTitle(conversationId, title)
      })
      .catch((err) => {
        namedConversations.delete(conversationId)
        console.warn('[maybeGenerateConversationName] Failed to generate name:', err)
      })
  },

  saveDataSourcesToConversation: (ids: string[]) => {
    let { currentConversation, conversations } = get()

    if (!currentConversation) {
      const sessionId = get().ensureSession()
      if (!sessionId) return
      currentConversation = get().currentConversation
      conversations = get().conversations
      if (!currentConversation) return
    }

    const updatedConversation: Conversation = {
      ...currentConversation,
      enabledDataSourceIds: ids,
    }

    set(
      {
        currentConversation: updatedConversation,
        conversations: updateConversationInList(conversations, updatedConversation),
      },
      false,
      'saveDataSourcesToConversation'
    )
  },
})
