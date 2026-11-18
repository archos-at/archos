import { v4 as uuidv4 } from 'uuid'
import type { CardDecision, CardInteractions } from '@/features/cards/card-decision'
import type { ChatMessage, Conversation, ErrorCode } from '../types'
import { useLayoutStore } from '@/features/layout/store'
import { withErrorMessage } from './connection-errors'
import { errorConcernsTheThread, getErrorMeta } from '../lib/error-registry'
import { mergeRemoteMessages } from '../lib/remote-message-merge'
import {
  createNewConversation,
  generateTitle,
  updateConversationInList,
  withConversation,
} from '../lib/conversation-records'
import type { MessagesGet, MessagesSet, MessagesSlice } from './messages-slice-types'

export const createConversationActions = (
  set: MessagesSet,
  get: MessagesGet
): Pick<
  MessagesSlice,
  | 'respondToPrompt'
  | 'addUserMessage'
  | 'adoptRunMessage'
  | 'patchConversationMessage'
  | 'setCardDecision'
  | 'addErrorCard'
  | 'dismissErrorCard'
  | 'dismissConnectionErrors'
  | 'setProjectId'
  | 'retryLastUserMessage'
  | 'insertRemoteMessages'
> => {
  return {
    respondToPrompt: (messageId: string, response: string) => {
      const { currentConversation, conversations } = get()
      if (!currentConversation) return

      const updatedMessages = currentConversation.messages.map((msg) =>
        msg.id === messageId ? { ...msg, promptResponse: response, isPromptResponded: true } : msg
      )

      const updatedConversation: Conversation = {
        ...currentConversation,
        messages: updatedMessages,
        updatedAt: new Date(),
      }

      const updatedConversations = updateConversationInList(conversations, updatedConversation)

      set(
        {
          currentConversation: updatedConversation,
          conversations: updatedConversations,
          isLoading: true,
          pendingInteraction: null,
        },
        false,
        'respondToPrompt'
      )

      void get()._persistPromptState(messageId, response)
    },

    addUserMessage: (
      content: string,
      metadata?: {
        enabledDataSources?: string[]
        messageFiles?: Array<{ id: string; fileName: string }>
      }
    ) => {
      const { currentConversation, conversations, currentUserId } = get()

      let conversation = currentConversation
      if (!conversation) {
        if (!currentUserId) {
          throw new Error('Cannot create conversation without authenticated user')
        }
        const layoutState = useLayoutStore.getState()
        conversation = {
          ...createNewConversation(currentUserId),
          projectId: get().projectId ?? null,
          enabledDataSourceIds: [...layoutState.enabledDataSourceIds],
        }
      }

      const newMessage: ChatMessage = {
        id: uuidv4(),
        role: 'user',
        content,
        timestamp: new Date(),
        messageType: 'user',
        enabledDataSources: metadata?.enabledDataSources,
        messageFiles: metadata?.messageFiles,
      }

      const hasUserMessage = conversation.messages.some((m) => m.messageType === 'user')
      const shouldUpdateTitle = !hasUserMessage

      const updatedConversation: Conversation = {
        ...conversation,
        title: shouldUpdateTitle ? generateTitle(content) : conversation.title,
        messages: [...conversation.messages, newMessage],
        updatedAt: new Date(),
      }

      const existingIndex = conversations.findIndex((c) => c.id === updatedConversation.id)
      let updatedConversations: Conversation[]

      if (existingIndex >= 0) {
        updatedConversations = updateConversationInList(conversations, updatedConversation)
      } else {
        updatedConversations = [updatedConversation, ...conversations]
      }

      set(
        {
          currentConversation: updatedConversation,
          conversations: updatedConversations,
          isLoading: true,
          currentUserMessageId: newMessage.id,
          currentTurnStartedAt: Date.now(),
        },
        false,
        'addUserMessage'
      )

      get()._appendMessage(newMessage)
      return newMessage
    },

    adoptRunMessage: (conversationId: string, message: ChatMessage) => {
      const { currentConversation, conversations } = get()
      const target =
        conversations.find((c) => c.id === conversationId) ??
        (currentConversation?.id === conversationId ? currentConversation : undefined)
      if (!target) return
      const at = target.messages.findIndex((existing) => existing.id === message.id)
      if (at >= 0 && target.messages[at] === message) return
      const messages =
        at < 0
          ? [...target.messages, message]
          : target.messages.map((existing, index) => (index === at ? message : existing))

      const updatedConversation: Conversation = {
        ...target,
        messages,
        updatedAt: new Date(),
      }

      set(
        {
          ...(currentConversation?.id === conversationId && {
            currentConversation: updatedConversation,
          }),
          conversations: updateConversationInList(conversations, updatedConversation),
        },
        false,
        'adoptRunMessage'
      )
    },

    patchConversationMessage: (
      conversationId: string,
      messageId: string,
      patch: Partial<ChatMessage>
    ) => {
      const { currentConversation, conversations } = get()

      const targetConversation = conversations.find((c) => c.id === conversationId)
      if (!targetConversation) return

      const updatedMessages = targetConversation.messages.map((msg) =>
        msg.id === messageId ? { ...msg, ...patch } : msg
      )

      const updatedConversation: Conversation = {
        ...targetConversation,
        messages: updatedMessages,
        updatedAt: new Date(),
      }

      const updatedConversations = updateConversationInList(conversations, updatedConversation)

      const updatedCurrent =
        currentConversation?.id === conversationId ? updatedConversation : currentConversation

      set(
        {
          currentConversation: updatedCurrent,
          conversations: updatedConversations,
        },
        false,
        'patchConversationMessage'
      )
    },

    setCardDecision: (messageId: string, cardKey: string, decision: CardDecision) => {
      const { currentConversation, conversations } = get()

      const targetConversation = currentConversation?.messages.some((m) => m.id === messageId)
        ? currentConversation
        : conversations.find((c) => c.messages.some((m) => m.id === messageId))
      if (!targetConversation) return

      let cardInteractions: CardInteractions | undefined
      const updatedMessages = targetConversation.messages.map((msg) => {
        if (msg.id !== messageId) return msg
        cardInteractions = {
          ...msg.cardInteractions,
          [cardKey]: { decision, decidedAt: new Date().toISOString() },
        }
        return { ...msg, cardInteractions }
      })
      if (!cardInteractions) return

      const updatedConversation: Conversation = {
        ...targetConversation,
        messages: updatedMessages,
      }

      set(
        {
          conversations: updateConversationInList(conversations, updatedConversation),
          ...(currentConversation?.id === targetConversation.id && {
            currentConversation: updatedConversation,
          }),
        },
        false,
        'setCardDecision'
      )

      void get()._persistCardInteractions(targetConversation.id, messageId, cardInteractions)
    },

    addErrorCard: (code: ErrorCode, message?: string, details?: string) => {
      const { currentConversation, conversations } = get()
      if (!currentConversation) return

      const errorMeta = getErrorMeta(code)

      const errorMessage: ChatMessage = {
        id: uuidv4(),
        role: 'assistant',
        content: message || errorMeta.defaultMessage,
        timestamp: new Date(),
        messageType: 'error',
        errorData: {
          errorCode: code,
          errorMessage: message,
          errorDetails: details,
        },
      }

      const updatedConversation: Conversation = {
        ...currentConversation,
        messages: withErrorMessage(currentConversation.messages, errorMessage),
        updatedAt: new Date(),
      }

      const updatedConversations = updateConversationInList(conversations, updatedConversation)

      set(
        {
          currentConversation: updatedConversation,
          conversations: updatedConversations,
        },
        false,
        'addErrorCard'
      )

      if (errorConcernsTheThread(code)) {
        void get()._appendMessage(errorMessage)
      }
    },

    dismissErrorCard: (messageId: string) => {
      const { currentConversation, conversations } = get()
      if (!currentConversation) return

      const updatedMessages = currentConversation.messages.filter((msg) => msg.id !== messageId)

      const updatedConversation: Conversation = {
        ...currentConversation,
        messages: updatedMessages,
        updatedAt: new Date(),
      }

      const updatedConversations = updateConversationInList(conversations, updatedConversation)

      set(
        {
          currentConversation: updatedConversation,
          conversations: updatedConversations,
        },
        false,
        'dismissErrorCard'
      )
    },

    dismissConnectionErrors: () => {
      const { currentConversation, conversations } = get()
      if (!currentConversation) return

      const updatedMessages = currentConversation.messages.filter(
        (msg) =>
          !(msg.messageType === 'error' && msg.errorData?.errorCode?.startsWith('connection.'))
      )

      if (updatedMessages.length === currentConversation.messages.length) return

      const updatedConversation: Conversation = {
        ...currentConversation,
        messages: updatedMessages,
        updatedAt: new Date(),
      }

      const updatedConversations = updateConversationInList(conversations, updatedConversation)

      set(
        {
          currentConversation: updatedConversation,
          conversations: updatedConversations,
        },
        false,
        'dismissConnectionErrors'
      )
    },

    setProjectId: (projectId: string | null) => {
      const { currentConversation } = get()

      if (
        projectId &&
        currentConversation?.projectId &&
        currentConversation.projectId !== projectId
      ) {
        set(
          {
            projectId,
            currentConversation: null,
            isStreaming: false,
            isLoading: false,
            currentUserMessageId: null,
            pendingInteraction: null,
          },
          false,
          'setProjectId:clearCrossProjectConversation'
        )
        return
      }

      set({ projectId }, false, 'setProjectId')
    },

    retryLastUserMessage: () => {
      const { currentConversation, chatSendFn, setComposerPrefill } = get()
      const messages = currentConversation?.messages
      if (!messages || messages.length === 0) return
      const lastUser = [...messages]
        .reverse()
        .find((msg) => msg.messageType === 'user' || msg.role === 'user')
      const text = lastUser?.content?.trim()
      if (!text) return
      const after = lastUser ? messages.indexOf(lastUser) : -1
      const failed = messages.filter((msg, index) => index > after && msg.failed)
      if (currentConversation && failed.length > 0) {
        set(
          withConversation(get(), { ...currentConversation, messages: messages.filter((msg) => !failed.includes(msg)) }),
          false,
          'retryLastUserMessage'
        )
      }
      if (chatSendFn) {
        chatSendFn(text)
      } else {
        setComposerPrefill(text)
      }
    },

    insertRemoteMessages: (
      conversationId: string,
      messages: ChatMessage[],
      options?: { replace?: boolean }
    ) => {
      const { conversations, currentConversation } = get()

      const target =
        conversations.find((c) => c.id === conversationId) ??
        (currentConversation?.id === conversationId ? currentConversation : undefined)
      if (!target) return

      const { messages: merged, added } = mergeRemoteMessages(
        target.messages,
        messages,
        options?.replace ?? false
      )
      if (merged === target.messages) return

      const updatedConversation: Conversation = {
        ...target,
        messages: merged,
        ...(added ? { updatedAt: new Date() } : {}),
      }

      set(
        {
          conversations: updateConversationInList(conversations, updatedConversation),
          ...(currentConversation?.id === conversationId && {
            currentConversation: updatedConversation,
          }),
        },
        false,
        'insertRemoteMessages'
      )

    },
  }
}
