import type { StateCreator } from 'zustand'
import type { ChatStore, Conversation } from '../types'
import { useLayoutStore } from '@/features/layout/store'
import { useDocumentsStore } from '@/features/documents/store'
import { discardSessionDocumentsResources } from '@/features/documents/discard-session-resources'
import { isAwaitingServerMessages } from './chat-storage'
import { hasLiveRun, hasNoUserChatMessages } from '../lib/session-activity'
import { conversationMatchesProject, isHiddenJobConversation } from '../lib/project-scope'
import { turnStateFor } from './messages-store'
import { withoutUnseenAnswer } from '../lib/turn-selectors'
import { createNewConversation } from './new-conversation'
import { hydratingConversationIds } from './session-server-sync'
import type { SessionsSlice } from './sessions-store'

const getDefaultEnabledDataSourceIds = (): string[] => {
  const layoutStore = useLayoutStore.getState()
  return layoutStore.availableDataSources?.map((source) => source.id) ?? []
}

const restoreConversationDataSources = (conversation: Conversation): void => {
  const layoutStore = useLayoutStore.getState()

  if (conversation.enabledDataSourceIds) {
    const availableIds = new Set(layoutStore.availableDataSources?.map((source) => source.id) ?? [])
    const validIds = conversation.enabledDataSourceIds.filter((id) => availableIds.has(id))
    layoutStore.setEnabledDataSources(validIds)
    return
  }

  const defaultIds = getDefaultEnabledDataSourceIds()
  layoutStore.setEnabledDataSources(defaultIds)
}

const maybeDiscardAbandonedUploadOnlySession = (
  get: () => ChatStore,
  sessionId: string | null | undefined
): void => {
  if (!sessionId) return

  const { conversations, currentUserId, pendingInteraction, currentConversation } = get()
  if (pendingInteraction && currentConversation?.id === sessionId) return

  const conv = conversations.find((c) => c.id === sessionId && c.userId === currentUserId)
  if (!conv) return
  if (isAwaitingServerMessages(conv.id) || hydratingConversationIds.has(conv.id)) return
  if (!hasNoUserChatMessages(conv.messages)) return
  if (hasLiveRun(conv.messages)) return

  const docsInFlight = useDocumentsStore
    .getState()
    .trackedFiles.some(
      (f) =>
        f.collectionName === sessionId && (f.status === 'uploading' || f.status === 'ingesting')
    )
  if (docsInFlight) return

  discardSessionDocumentsResources(sessionId)
  get().deleteConversation(sessionId)
}

export const createSessionNavigationSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  Pick<
    SessionsSlice,
    | 'setPendingMessagesFor'
    | 'setCurrentUser'
    | 'getUserConversations'
    | 'createConversation'
    | 'startNewSessionDraft'
    | 'ensureSession'
    | 'selectConversation'
    | 'restoreSessionState'
    | 'hasAnyBusySession'
  >
> = (set, get) => ({
  setPendingMessagesFor: (conversationId: string | null) => {
    if (get().pendingMessagesFor === conversationId) return
    set({ pendingMessagesFor: conversationId }, false, 'setPendingMessagesFor')
  },

  setCurrentUser: (userId: string | null) => {
    const { conversations, currentConversation, projectId } = get()

    const shouldClearCurrent =
      currentConversation && (userId === null || currentConversation.userId !== userId)

    const userConversations = userId
      ? conversations.filter(
          (c) =>
            c.userId === userId &&
            conversationMatchesProject(c, projectId) &&
            !isHiddenJobConversation(c)
        )
      : []
    const newCurrentConversation = shouldClearCurrent
      ? userConversations[0] || null
      : currentConversation

    set(
      {
        currentUserId: userId,
        currentConversation: newCurrentConversation,
      },
      false,
      'setCurrentUser'
    )

    if (newCurrentConversation) {
      get().restoreSessionState(newCurrentConversation)
      restoreConversationDataSources(newCurrentConversation)
    } else {
      set(
        {
          pendingInteraction: null,
        },
        false,
        'setCurrentUser:clearState'
      )
    }
  },

  getUserConversations: () => {
    const { conversations, currentUserId, projectId } = get()
    if (!currentUserId) return []
    return conversations.filter(
      (c) =>
        c.userId === currentUserId &&
        conversationMatchesProject(c, projectId) &&
        !isHiddenJobConversation(c)
    )
  },

  createConversation: () => {
    const { currentUserId, projectId } = get()
    if (!currentUserId) {
      throw new Error('Cannot create conversation without authenticated user')
    }
    const layoutState = useLayoutStore.getState()
    const defaultEnabledDataSourceIds = getDefaultEnabledDataSourceIds()
    layoutState.setEnabledDataSources(defaultEnabledDataSourceIds)
    const newConversation: Conversation = {
      ...createNewConversation(currentUserId, projectId ?? null, get().composerSubject),
      enabledDataSourceIds: defaultEnabledDataSourceIds,
    }
    set(
      (state) => ({
        conversations: [newConversation, ...state.conversations],
        currentConversation: newConversation,
        pendingInteraction: null,
      }),
      false,
      'createConversation'
    )
    return newConversation
  },

  startNewSessionDraft: () => {
    const { currentUserId, currentConversation } = get()
    if (!currentUserId) {
      throw new Error('Cannot start session draft without authenticated user')
    }

    maybeDiscardAbandonedUploadOnlySession(get, currentConversation?.id)

    const layoutState = useLayoutStore.getState()
    const defaultEnabledDataSourceIds = getDefaultEnabledDataSourceIds()
    layoutState.setEnabledDataSources(defaultEnabledDataSourceIds)

    set(
      {
        currentConversation: null,
        composerSubject: null,
        isStreaming: false,
        isLoading: false,
        currentUserMessageId: null,
        pendingInteraction: null,
        pendingMessagesFor: null,
      },
      false,
      'startNewSessionDraft'
    )
  },

  ensureSession: () => {
    const { currentConversation, currentUserId, projectId } = get()

    if (currentConversation?.id) {
      return currentConversation.id
    }
    if (!currentUserId) {
      return undefined
    }

    const layoutState = useLayoutStore.getState()
    const defaultEnabledDataSourceIds = getDefaultEnabledDataSourceIds()
    layoutState.setEnabledDataSources(defaultEnabledDataSourceIds)
    const newConversation: Conversation = {
      ...createNewConversation(currentUserId, projectId ?? null, get().composerSubject),
      enabledDataSourceIds: defaultEnabledDataSourceIds,
    }
    set(
      (state) => ({
        conversations: [newConversation, ...state.conversations],
        currentConversation: newConversation,
        pendingInteraction: null,
      }),
      false,
      'ensureSession'
    )
    return newConversation.id
  },

  selectConversation: (conversationId: string) => {
    const beforeLeave = get()
    const leavingId =
      beforeLeave.currentConversation?.id && beforeLeave.currentConversation.id !== conversationId
        ? beforeLeave.currentConversation.id
        : undefined

    const canOpen = (candidate: Conversation | undefined): candidate is Conversation =>
      candidate !== undefined &&
      candidate.userId === get().currentUserId &&
      conversationMatchesProject(candidate, get().projectId)

    if (leavingId) maybeDiscardAbandonedUploadOnlySession(get, leavingId)

    const conversation = get().conversations.find((c) => c.id === conversationId)
    if (canOpen(conversation)) {
      set(
        {
          currentConversation: conversation,
          unseenAnswers: withoutUnseenAnswer(get().unseenAnswers, conversation.id),
          pendingMessagesFor: null,
          composerSubject: conversation.subjectResourceId
            ? {
                resourceType: 'document' as const,
                resourceId: conversation.subjectResourceId,
                title: null,
              }
            : null,
        },
        false,
        'selectConversation'
      )

      get().restoreSessionState(conversation)
      restoreConversationDataSources(conversation)

      if (conversation.messages.length === 0 || isAwaitingServerMessages(conversation.id)) {
        void get().hydrateConversationMessages(conversation.id)
      }
    }
  },

  restoreSessionState: (conversation: Conversation) => {
    const turnState = turnStateFor(get().turns, conversation.id)
    set(turnState, false, 'restoreSessionState')
    if (turnState.isStreaming || turnState.pendingInteraction) return

    const meaningfulTypes = new Set(['user', 'assistant', 'agent_response', 'error', 'prompt'])
    const last = conversation.messages.findLast((m) => meaningfulTypes.has(m.messageType ?? ''))
    const mine = !last?.authorUserId || last.authorUserId === get().currentUserId
    const turnId =
      last?.messageType === 'user' && mine
        ? last.id
        : last?.messageType === 'prompt'
          ? last.promptParentId
          : undefined
    if (turnId) set({ resumableTurn: { conversationId: conversation.id, turnId } }, false, 'restoreSessionState:resumable')
  },

  hasAnyBusySession: () => Object.values(get().turns).some((view) => view.phase === 'running'),
})
