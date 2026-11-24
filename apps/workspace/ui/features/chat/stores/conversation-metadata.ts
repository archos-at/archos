import type { StateCreator } from 'zustand'
import type { ChatMessage, ChatStore, Conversation } from '../types'
import type { SessionsSlice } from './sessions-store'
import { getActiveLocale } from '@/i18n'
import { updateConversationInList } from '../lib/conversation-updates'
import { getConversationsClient } from '../lib/conversations-client-access'
import { named, settledTitle } from '../lib/conversation-title'

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
> = (set, get) => {
  const retitle = (conversationId: string, change: (conversation: Conversation) => Conversation, action: string): void => {
    const { currentConversation, conversations } = get()
    const open = currentConversation?.id === conversationId ? change(currentConversation) : currentConversation
    const listed = conversations.map((c) => (c.id === conversationId ? change(c) : c))
    if (open === currentConversation && listed.every((c, i) => c === conversations[i])) return
    set({ conversations: listed, currentConversation: open }, false, action)
  }

  const syncTitle = (conversationId: string, title: string): void => {
    getConversationsClient().then((conversationsClient) => {
      conversationsClient.updateTitle(conversationId, title).catch((err) => {
        console.warn('[updateConversationTitle] Failed to sync title to server:', err)
      })
    })
  }

  return {
  updateConversationTitle: (conversationId: string, title: string) => {
    retitle(conversationId, (conversation) => ({ ...named(conversation, title), updatedAt: new Date() }), 'updateConversationTitle')
    syncTitle(conversationId, title)
  },

  maybeGenerateConversationName: (conversationId: string) => {
    if (namedConversations.has(conversationId)) return
    const settle = (): void => retitle(conversationId, settledTitle, 'settleProvisionalTitle')

    const { conversations } = get()
    const conversation = conversations.find((c) => c.id === conversationId)
    if (!conversation) return

    const hasRun = conversation.messages.some((m) => Boolean(m.runLedger || m.deepResearchJobId))
    const userMessages = conversation.messages.filter((m) => m.messageType === 'user')
    const firstQuestion = userMessages.length === 1 ? messagePlainText(userMessages[0]) : ''
    const firstAnswer = conversation.messages.find(
      (m) => m.messageType === 'agent_response' && messagePlainText(m).length > 0
    )
    if (hasRun || !firstQuestion || !firstAnswer) return settle()

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
          settle()
          return
        }
        retitle(conversationId, (c) => named(c, title), 'nameConversation')
        syncTitle(conversationId, title)
      })
      .catch((err) => {
        namedConversations.delete(conversationId)
        settle()
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
  }
}
