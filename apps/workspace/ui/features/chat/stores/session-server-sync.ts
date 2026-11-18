import type { StateCreator } from 'zustand'
import type { ChatStore, Conversation } from '../types'
import type { SessionsSlice } from './sessions-store'
import {
  clearAwaitingServerMessages,
  isAwaitingServerMessages,
  markAwaitingServerMessages,
} from './chat-storage'
import { mapServerMessagesToChatMessages } from '../lib/server-message-mapper'
import { mergeRemoteMessages } from './messages-store'
import { updateConversationInList } from '../lib/conversation-updates'
import { getConversationsClient, isRightsLost } from '../lib/conversations-client-access'

export const hydratingConversationIds = new Set<string>()

export const createSessionServerSyncSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  Pick<
    SessionsSlice,
    | 'loadServerConversations'
    | 'hydrateConversationMessages'
    | '_lockConversation'
  >
> = (set, get) => ({
  loadServerConversations: async (projectId?: string) => {
    try {
      const conversationsClient = await getConversationsClient()
      const serverConvs = await conversationsClient.list(projectId)
      if (!serverConvs || serverConvs.length === 0) return

      const { conversations, currentUserId } = get()
      const merged = [...conversations]

      for (const serverConv of serverConvs) {
        const idx = merged.findIndex((c) => c.id === serverConv.id)
        const locked = serverConv.contentLocked === true
        const local: Conversation = {
          id: serverConv.id,
          userId: currentUserId ?? serverConv.createdBy ?? 'unknown',
          projectId: serverConv.projectId ?? (idx >= 0 ? merged[idx].projectId : null) ?? null,
          title: locked ? '' : (serverConv.title ?? (idx >= 0 ? merged[idx].title : '') ?? ''),
          messages: idx >= 0 && !locked ? merged[idx].messages : [],
          ...(locked ? { contentLocked: true } : {}),
          enabledDataSourceIds: idx >= 0 ? merged[idx].enabledDataSourceIds : undefined,
          createdAt: new Date(serverConv.createdAt as unknown as string),
          updatedAt: new Date(serverConv.updatedAt as unknown as string),
          jobId: serverConv.jobId ?? null,
          temporary: serverConv.temporary === true,
          subjectResourceType: locked
            ? null
            : serverConv.subjectResourceType === 'document'
              ? 'document'
              : ((idx >= 0 ? merged[idx].subjectResourceType : null) ?? null),
          subjectResourceId: locked
            ? null
            : (serverConv.subjectResourceId ??
              (idx >= 0 ? merged[idx].subjectResourceId : null) ??
              null),
        }
        if (idx >= 0) {
          if (merged[idx].contentLocked && !locked) markAwaitingServerMessages(local.id)
          merged[idx] = local
        } else {
          if (!locked) markAwaitingServerMessages(local.id)
          merged.push(local)
        }
      }

      const open = get().currentConversation
      const refreshedOpen = open ? merged.find((c) => c.id === open.id) : undefined
      const openChanged = refreshedOpen !== undefined && (refreshedOpen.contentLocked === true) !== (open?.contentLocked === true)
      set(
        {
          conversations: merged,
          ...(openChanged ? { currentConversation: refreshedOpen } : {}),
        },
        false,
        'loadServerConversations'
      )

      const { currentConversation } = get()
      if (
        currentConversation?.contentLocked !== true &&
        currentConversation &&
        (currentConversation.messages.length === 0 ||
          isAwaitingServerMessages(currentConversation.id))
      ) {
        void get().hydrateConversationMessages(currentConversation.id)
      }
    } catch (err) {
      console.warn('[loadServerConversations] Failed to load server conversations:', err)
    } finally {
      set({ serverConversationsLoaded: true }, false, 'serverConversationsLoaded')
    }
  },

  hydrateConversationMessages: async (conversationId: string) => {
    const conversation = get().conversations.find((c) => c.id === conversationId)
    if (!conversation) return
    if (conversation.contentLocked) return
    if (conversation.messages.length > 0 && !isAwaitingServerMessages(conversationId)) return
    if (get().currentConversation?.id === conversationId) get().setPendingMessagesFor(conversationId)
    if (hydratingConversationIds.has(conversationId)) return
    hydratingConversationIds.add(conversationId)
    const settledPending = (): Pick<SessionsSlice, 'pendingMessagesFor'> | Record<string, never> =>
      get().pendingMessagesFor === conversationId ? { pendingMessagesFor: null } : {}

    try {
      const conversationsClient = await getConversationsClient()
      const serverMessages = await conversationsClient.listMessages(conversationId)
      const messages = mapServerMessagesToChatMessages(serverMessages)

      const { conversations, currentConversation, isStreaming, isLoading } = get()
      const target = conversations.find((c) => c.id === conversationId)
      if (!target) return
      if (messages.length === 0) {
        if (target.messages.length === 0) clearAwaitingServerMessages(conversationId)
        return
      }

      const { messages: merged } = mergeRemoteMessages(target.messages, messages, false)
      const hydrated: Conversation = { ...target, messages: merged }
      const isCurrent = currentConversation?.id === conversationId

      clearAwaitingServerMessages(conversationId)
      set(
        {
          conversations: updateConversationInList(conversations, hydrated),
          ...(isCurrent && { currentConversation: hydrated }),
          ...settledPending(),
        },
        false,
        'hydrateConversationMessages'
      )

      if (isCurrent && !isStreaming && !isLoading) {
        get().restoreSessionState(hydrated)
      }
    } catch (err) {
      if (isRightsLost(err)) get()._lockConversation(conversationId)
      else console.warn('[hydrateConversationMessages] Failed to load messages from server:', err)
    } finally {
      hydratingConversationIds.delete(conversationId)
      const pending = settledPending()
      if ('pendingMessagesFor' in pending) set(pending, false, 'hydrateConversationMessages/settled')
    }
  },

  _lockConversation: (conversationId: string) => {
    const { conversations, currentConversation } = get()
    const lock = (conversation: Conversation): Conversation => ({
      ...conversation,
      title: '',
      messages: [],
      subjectResourceType: null,
      subjectResourceId: null,
      contentLocked: true,
    })
    clearAwaitingServerMessages(conversationId)
    set(
      {
        conversations: conversations.map((c) => (c.id === conversationId ? lock(c) : c)),
        ...(currentConversation?.id === conversationId ? { currentConversation: lock(currentConversation) } : {}),
      },
      false,
      'lockConversation'
    )
  },
})
