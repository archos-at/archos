import { getActiveLocale } from '@/i18n'
import type { StateCreator } from 'zustand'
import type {
  ChatStore,
  Conversation,
  ChatMessage,
  RecoveryOutcome,
  ResumableTurn,
} from '../types'
import { useLayoutStore } from '@/features/layout/store'
import { forgetThreadPosition } from '@/features/layout/lib/thread-positions'
import { useDocumentsStore } from '@/features/documents/store'
import { discardSessionDocumentsResources } from '@/features/documents/discard-session-resources'
import {
  clearAwaitingServerMessages,
  isAwaitingServerMessages,
  markAwaitingServerMessages,
} from './chat-storage'
import { hasLiveRun, hasNoUserChatMessages, liveRunMessages } from '../lib/session-activity'
import { cancelRun } from '@/lib/runs/run-view-client'
import {
  conversationMatchesProject,
  isHiddenJobConversation,
  isJobConversation,
} from '../lib/project-scope'
import { mapServerMessagesToChatMessages } from '../lib/server-message-mapper'
import { mergeRemoteMessages, turnStateFor } from './messages-store'
import { encodeCitations } from '../lib/citations'
import { markConversationOnServer } from '../lib/conversation-on-server'
import { recordCreateFailed, recordCreateStarted, recordCreatedTemporary } from '../lib/temporary-created'
import { createNewConversation } from './new-conversation'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { MessageStages } from '@/lib/conversations/message-stages'

export type SessionsSlice = {
  currentUserId: string | null
  currentConversation: Conversation | null
  conversations: Conversation[]
  isRecoveryPending: boolean
  resumableTurn: ResumableTurn | null

  serverConversationsLoaded: boolean

  pendingMessagesFor: string | null

  setPendingMessagesFor: (conversationId: string | null) => void

  loadServerConversations: (projectId?: string) => Promise<void>
  hydrateConversationMessages: (conversationId: string) => Promise<void>
  _lockConversation: (conversationId: string) => void
  setCurrentUser: (userId: string | null) => void
  getUserConversations: () => Conversation[]
  createConversation: () => Conversation
  startNewSessionDraft: () => void
  ensureSession: () => string | undefined
  selectConversation: (conversationId: string) => void
  deleteConversation: (conversationId: string) => void
  deleteAllConversations: () => void
  updateConversationTitle: (conversationId: string, title: string) => void
  maybeGenerateConversationName: (conversationId: string) => void
  saveDataSourcesToConversation: (ids: string[]) => void
  restoreSessionState: (conversation: Conversation) => void
  _recoverInterruptedAssistantMessage: (
    conversationId: string,
    afterUserMessageId: string,
    options?: { quiet?: boolean }
  ) => Promise<RecoveryOutcome>
  _awaitServerAnswer: (conversationId: string, afterUserMessageId: string) => Promise<RecoveryOutcome>
  isSessionBusy: (conversationId: string) => boolean
  hasAnyBusySession: () => boolean
  _ensureConversationExists: () => Promise<void>
  _appendMessage: (message: ChatMessage) => Promise<void>
  _persistCardInteractions: (
    conversationId: string,
    messageId: string,
    cardInteractions: CardInteractions
  ) => Promise<void>
  _persistTurnProvenance: (after?: Promise<unknown>) => Promise<void>
  _persistPromptState: (messageId: string, response: string) => Promise<void>
  _persistStageOutput: (conversationId: string, messageId: string, stages: MessageStages) => Promise<void>
  _cutStoppedAnswer: (conversationId: string, messageId: string, turnId: string, shown: string) => Promise<void>
}

const updateConversationInList = (
  conversations: Conversation[],
  updatedConversation: Conversation
): Conversation[] => {
  return conversations.map((c) => (c.id === updatedConversation.id ? updatedConversation : c))
}

export const patchConversationMessageById = (
  conversation: Conversation,
  messageId: string,
  patch: Partial<ChatMessage>
): Conversation => {
  let didPatch = false
  const messages = conversation.messages.map((message) => {
    if (message.id !== messageId) return message
    didPatch = true
    return { ...message, ...patch }
  })

  return didPatch ? { ...conversation, messages, updatedAt: new Date() } : conversation
}

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

let conversationsClientModule: Promise<
  typeof import('@/adapters/api/conversations-client')
> | null = null
const TURN_SILENCE_MS = 70_000
const AWAIT_ANSWER_POLL_MS = 4_000
const AWAIT_ANSWER_BLIND_MS = 120_000
const AWAIT_ANSWER_CEILING_MS = 40 * 60_000

const serverAnswerWaits = new Map<string, Promise<RecoveryOutcome>>()

let recoveryHolds = 0

const isRightsLost = (error: unknown): boolean =>
  error instanceof Error && error.name === 'ConversationRightsLostError'

const getConversationsClient = () => {
  conversationsClientModule ??= import('@/adapters/api/conversations-client')
  return conversationsClientModule.then((m) => m.conversationsClient)
}

const hydratingConversationIds = new Set<string>()

const ensuredServerConversations = new Map<string, Promise<void>>()

const ensureServerConversation = (
  conversation: Conversation,
  fallbackProjectId: string | null
): Promise<void> => {
  const inFlight = ensuredServerConversations.get(conversation.id)
  if (inFlight) return inFlight

  const promise = (async () => {
    const conversationsClient = await getConversationsClient()
    recordCreateStarted(conversation.id, conversation.temporary === true)
    const created = await conversationsClient.create(
      conversation.id,
      conversation.title || undefined,
      conversation.projectId ?? fallbackProjectId,
      conversation.subjectResourceId
        ? { resourceType: 'document', resourceId: conversation.subjectResourceId }
        : null,
      conversation.temporary
    )
    recordCreatedTemporary(conversation.id, created?.temporary === true)
    markConversationOnServer(conversation.id)
  })()

  const tracked = promise.catch((err) => {
    ensuredServerConversations.delete(conversation.id)
    recordCreateFailed(conversation.id)
    throw err
  })
  ensuredServerConversations.set(conversation.id, tracked)
  return tracked
}

const forgetServerConversation = (conversationId: string): void => {
  ensuredServerConversations.delete(conversationId)
}

const namedConversations = new Set<string>()

const messagePlainText = (message: ChatMessage): string => (message.content ?? '').trim()

const cancelLiveRuns = (
  conversations: Conversation[],
  activeProjectId: string | null
): void => {
  for (const conversation of conversations) {
    const projectId = conversation.projectId ?? activeProjectId
    if (!projectId) continue
    for (const message of liveRunMessages(conversation.messages)) {
      const runId = message.runLedger?.runId
      if (!runId) continue
      cancelRun(projectId, runId).catch((err) => {
        console.warn('[deleteConversation] Failed to stop a live run:', runId, err)
      })
    }
  }
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

export const initialSessionsState = {
  currentUserId: null as string | null,
  currentConversation: null as Conversation | null,
  conversations: [] as Conversation[],
  isRecoveryPending: false,
  resumableTurn: null as ResumableTurn | null,
  serverConversationsLoaded: false,
  pendingMessagesFor: null as string | null,
}

export const createSessionsSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  SessionsSlice
> = (set, get) => ({
  ...initialSessionsState,

  setPendingMessagesFor: (conversationId: string | null) => {
    if (get().pendingMessagesFor === conversationId) return
    set({ pendingMessagesFor: conversationId }, false, 'setPendingMessagesFor')
  },

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

  deleteConversation: (conversationId: string) => {
    const { currentConversation, conversations, composerDrafts } = get()

    const conversationToDelete = conversations.find((c) => c.id === conversationId)
    if (conversationToDelete) cancelLiveRuns([conversationToDelete], get().projectId)

    const updatedConversations = conversations.filter((c) => c.id !== conversationId)

    let nextComposerDrafts = composerDrafts
    if (conversationId in composerDrafts) {
      nextComposerDrafts = { ...composerDrafts }
      delete nextComposerDrafts[conversationId]
    }

    forgetServerConversation(conversationId)
    forgetThreadPosition(conversationId)
    getConversationsClient().then((conversationsClient) => {
      conversationsClient.delete(conversationId).catch((err) => {
        console.warn('[deleteConversation] Failed to delete server conversation:', err)
      })
    })

    set(
      {
        conversations: updatedConversations,
        composerDrafts: nextComposerDrafts,
        currentConversation:
          currentConversation?.id === conversationId ? null : currentConversation,
      },
      false,
      'deleteConversation'
    )
  },

  deleteAllConversations: () => {
    const { conversations, currentUserId, currentConversation, projectId, composerDrafts } = get()

    if (!currentUserId) return

    const isInScope = (c: Conversation): boolean =>
      c.userId === currentUserId &&
      conversationMatchesProject(c, projectId) &&
      !isJobConversation(c)

    const userConversations = conversations.filter(isInScope)
    cancelLiveRuns(userConversations, projectId)

    userConversations.forEach((conv) => {
      forgetServerConversation(conv.id)
      forgetThreadPosition(conv.id)
    })
    getConversationsClient().then(async (conversationsClient) => {
      const results = await Promise.allSettled(
        userConversations.map((conv) => conversationsClient.delete(conv.id))
      )
      results.forEach((result, index) => {
        if (result.status === 'rejected') {
          console.warn(
            '[deleteAllConversations] Failed to delete server conversation:',
            userConversations[index].id,
            result.reason
          )
        }
      })
    })

    const remainingConversations = conversations.filter((c) => !isInScope(c))

    const removedSessionIds = new Set(userConversations.map((c) => c.id))
    const nextComposerDrafts = Object.fromEntries(
      Object.entries(composerDrafts).filter(([id]) => !removedSessionIds.has(id))
    )

    const shouldClearCurrent = currentConversation && isInScope(currentConversation)

    set(
      {
        conversations: remainingConversations,
        composerDrafts: nextComposerDrafts,
        currentConversation: shouldClearCurrent ? null : currentConversation,
        pendingInteraction: null,
      },
      false,
      'deleteAllConversations'
    )
  },

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

  _awaitServerAnswer: (conversationId: string, afterUserMessageId: string): Promise<RecoveryOutcome> => {
    if (serverAnswerWaits.has(conversationId)) return Promise.resolve('superseded')
    const wait = (async (): Promise<RecoveryOutcome> => {
      recoveryHolds += 1
      set({ isRecoveryPending: true }, false, 'awaitServerAnswer:start')
      try {
        const conversationsClient = await getConversationsClient()
        const started = Date.now()
        for (;;) {
          const outcome = await get()._recoverInterruptedAssistantMessage(
            conversationId,
            afterUserMessageId,
            { quiet: true }
          )
          if (outcome !== 'nothing') return outcome
          const elapsed = Date.now() - started
          if (elapsed >= AWAIT_ANSWER_CEILING_MS) return 'nothing'
          const age = await conversationsClient.newestFrameAge(conversationId)
          const alive =
            age === undefined ? elapsed < AWAIT_ANSWER_BLIND_MS : age !== null && age < TURN_SILENCE_MS
          if (!alive) {
            return get()._recoverInterruptedAssistantMessage(conversationId, afterUserMessageId, {
              quiet: true,
            })
          }
          await new Promise((resolve) => setTimeout(resolve, AWAIT_ANSWER_POLL_MS))
        }
      } finally {
        recoveryHolds -= 1
        if (recoveryHolds === 0) set({ isRecoveryPending: false }, false, 'awaitServerAnswer:end')
      }
    })().finally(() => {
      serverAnswerWaits.delete(conversationId)
    })
    serverAnswerWaits.set(conversationId, wait)
    return wait
  },

  _recoverInterruptedAssistantMessage: async (
    conversationId: string,
    afterUserMessageId: string,
    { quiet = false }: { quiet?: boolean } = {}
  ): Promise<RecoveryOutcome> => {
    if (!quiet) {
      recoveryHolds += 1
      set({ isRecoveryPending: true }, false, 'recoveryPending:start')
    }
    try {
      const conversationsClient = await getConversationsClient()
      const serverMessages = await conversationsClient.listMessages(conversationId)
      const mapped = mapServerMessagesToChatMessages(serverMessages)

      const { conversations, currentConversation, isStreaming } = get()
      const target = conversations.find((c) => c.id === conversationId)
      if (!target || isStreaming) return 'superseded'

      const localIds = new Set(target.messages.map((m) => m.id))

      const userIdx = mapped.findIndex((m) => m.id === afterUserMessageId)
      const searchSpace = userIdx >= 0 ? mapped.slice(userIdx + 1) : mapped
      const answers = searchSpace.filter((m) => m.role === 'assistant')
      const recovered = answers.find((m) => !localIds.has(m.id))
      if (!recovered) return answers.length > 0 ? 'superseded' : 'nothing'

      const merged: Conversation = {
        ...target,
        messages: [...target.messages, recovered],
      }
      set(
        {
          conversations: updateConversationInList(conversations, merged),
          ...(currentConversation?.id === conversationId && { currentConversation: merged }),
        },
        false,
        'recoverInterruptedAssistantMessage'
      )
      return 'recovered'
    } catch (err) {
      console.warn('[recoverInterruptedAssistantMessage] Failed:', err)
      return 'nothing'
    } finally {
      if (!quiet) {
        recoveryHolds -= 1
        if (recoveryHolds === 0) set({ isRecoveryPending: false }, false, 'recoveryPending:end')
      }
    }
  },

  isSessionBusy: (conversationId: string) => {
    const state = get()
    return state.currentConversation?.id === conversationId && state.isStreaming
  },

  hasAnyBusySession: () => {
    const state = get()
    if (state.pendingInteraction !== null) return true
    return state.conversations.some((conv) => state.isSessionBusy(conv.id))
  },

  _ensureConversationExists: async () => {
    const { currentConversation, projectId } = get()
    if (!currentConversation) return

    try {
      await ensureServerConversation(currentConversation, projectId ?? null)
    } catch (err) {
      console.warn('[ensureConversationExists] Failed:', err)
    }
  },

  _appendMessage: async (message: ChatMessage) => {
    const { currentConversation, projectId } = get()
    if (!currentConversation) return

    try {
      const conversationsClient = await getConversationsClient()

      await ensureServerConversation(currentConversation, projectId ?? null)

      await conversationsClient.createMessage(currentConversation.id, {
        id: message.id,
        role: message.role,
        content: message.content,
        messageType: message.messageType,
        metadata: {
          ...(message.errorData && { errorData: message.errorData }),
          ...(message.fileData && { fileData: message.fileData }),
          ...(message.cards && { cards: message.cards }),
          ...(message.answerMeta && { answerMeta: message.answerMeta }),
          ...(message.stopped && { provenance: { stopped: true } }),
          ...(message.cardInteractions && { cardInteractions: message.cardInteractions }),
          ...(message.enabledDataSources && { enabledDataSources: message.enabledDataSources }),
          ...(message.messageFiles && { messageFiles: message.messageFiles }),
          ...(message.messageType === 'prompt'
            ? {
                prompt: {
                  ...(message.promptId && { promptId: message.promptId }),
                  ...(message.promptParentId && { promptParentId: message.promptParentId }),
                  ...(message.promptInputType && { promptInputType: message.promptInputType }),
                  ...(message.promptOptions && { promptOptions: message.promptOptions }),
                  ...(message.promptPlaceholder && {
                    promptPlaceholder: message.promptPlaceholder,
                  }),
                  ...(get().currentUserId ? { promptFor: get().currentUserId } : {}),
                },
              }
            : {}),
          ...(() => {
            const citations = encodeCitations(message.citations)
            return citations ? { citations } : {}
          })(),
          ...(() => {
            const readSources = encodeCitations(message.readSources)
            return readSources ? { readSources } : {}
          })(),
        },
        createdAt:
          message.timestamp instanceof Date
            ? message.timestamp.toISOString()
            : String(message.timestamp),
      })
    } catch (err) {
      if (isRightsLost(err)) get()._lockConversation(currentConversation.id)
      else console.warn('[appendMessage] Failed:', err)
    }
  },

  _persistPromptState: async (messageId: string, response: string) => {
    const { currentConversation } = get()
    if (!currentConversation) return
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.updateMessagePromptState(currentConversation.id, messageId, {
        response,
      })
    } catch (err) {
      console.warn('[persistPromptState] Failed:', err)
    }
  },

  _persistStageOutput: async (conversationId: string, messageId: string, stages: MessageStages) => {
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.updateMessageStages(conversationId, messageId, {
        ...stages,
      })
    } catch (err) {
      console.warn('[persistStageOutput] Failed:', err)
    }
  },

  _persistTurnProvenance: async (after?: Promise<unknown>) => {
    const { currentConversation, currentUserMessageId } = get()
    if (!currentConversation) return

    const messages = currentConversation.messages
    const userMessage = currentUserMessageId
      ? messages.find((message) => message.id === currentUserMessageId)
      : undefined
    const assistantMessage = [...messages].reverse().find((message) => message.role === 'assistant')

    const targets: Array<[string, Record<string, unknown>]> = []

    if (userMessage?.thinkingSteps?.length) {
      targets.push([userMessage.id, { thinkingSteps: userMessage.thinkingSteps }])
    }

    if (assistantMessage) {
      const provenance: Record<string, unknown> = {}
      if (assistantMessage.answerConfidence) {
        provenance.answerConfidence = assistantMessage.answerConfidence
      }
      if (assistantMessage.answerConfidenceCappedReason) {
        provenance.answerConfidenceCappedReason = assistantMessage.answerConfidenceCappedReason
      }
      if (assistantMessage.answerConfidenceReason) {
        provenance.answerConfidenceReason = assistantMessage.answerConfidenceReason
      }
      if (assistantMessage.routingDecision) {
        provenance.routingDecision = assistantMessage.routingDecision
      }
      if (assistantMessage.escalationReason) {
        provenance.escalationReason = assistantMessage.escalationReason
      }
      if (assistantMessage.answerDurationMs) {
        provenance.answerDurationMs = assistantMessage.answerDurationMs
      }
      if (assistantMessage.reasoningEffort) {
        provenance.reasoningEffort = assistantMessage.reasoningEffort
      }
      if (assistantMessage.citationsRemoved) {
        provenance.citationsRemoved = assistantMessage.citationsRemoved
      }
      if (assistantMessage.skillsActivated?.length) {
        provenance.skillsActivated = assistantMessage.skillsActivated
      }
      if (assistantMessage.skillsHidden?.length) {
        provenance.skillsHidden = assistantMessage.skillsHidden
      }
      if (assistantMessage.researchTruncated) provenance.researchTruncated = true
      if (assistantMessage.stopped) provenance.stopped = true
      if (assistantMessage.truncationReason)
        provenance.truncationReason = assistantMessage.truncationReason
      if (assistantMessage.degradedReasons?.length)
        provenance.degradedReasons = assistantMessage.degradedReasons
      if (assistantMessage.deepResearchJobId) {
        provenance.deepResearchJobId = assistantMessage.deepResearchJobId
      }
      if (assistantMessage.retrievalLedger && assistantMessage.retrievalLedger.length > 0) {
        provenance.retrievalLedger = assistantMessage.retrievalLedger
      }
      if (assistantMessage.quoteStamps && assistantMessage.quoteStamps.length > 0) {
        provenance.quoteStamps = assistantMessage.quoteStamps
      }
      if (assistantMessage.confidenceCheck) provenance.confidenceCheck = assistantMessage.confidenceCheck
      if (assistantMessage.answerConfidenceVersion) {
        provenance.answerConfidenceVersion = assistantMessage.answerConfidenceVersion
      }
      if (assistantMessage.lookupFoundNothing) provenance.lookupFoundNothing = true

      if (Object.keys(provenance).length > 0) targets.push([assistantMessage.id, provenance])
    }

    if (targets.length === 0) return

    try {
      await after?.catch(() => undefined)
      const conversationsClient = await getConversationsClient()
      for (const [messageId, provenance] of targets) {
        await conversationsClient.updateMessageProvenance(
          currentConversation.id,
          messageId,
          provenance
        )
      }
    } catch (err) {
      console.warn('[persistTurnProvenance] Failed:', err)
    }
  },

  _cutStoppedAnswer: async (conversationId: string, messageId: string, turnId: string, shown: string) => {
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.cutStoppedAnswer(conversationId, messageId, { turnId, shown })
    } catch (err) {
      console.warn('[cutStoppedAnswer] Failed:', err)
    }
  },

  _persistCardInteractions: async (
    conversationId: string,
    messageId: string,
    cardInteractions: CardInteractions
  ) => {
    try {
      const conversationsClient = await getConversationsClient()
      await conversationsClient.updateMessageCardInteractions(
        conversationId,
        messageId,
        cardInteractions
      )
    } catch (err) {
      console.warn('[persistCardInteractions] Failed:', err)
    }
  },
})
