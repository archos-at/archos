import type { StateCreator } from 'zustand'
import type {
  ChatStore,
  Conversation,
  ChatMessage,
  RecoveryOutcome,
  ResumableTurn,
} from '../types'
import { forgetThreadPosition } from '@/features/layout/lib/thread-positions'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { MessageStages } from '@/lib/conversations/message-stages'
import { cancelRun } from '@/lib/runs/run-view-client'
import { conversationMatchesProject, isJobConversation } from '../lib/project-scope'
import { liveRunMessages } from '../lib/session-activity'
import { getConversationsClient } from '../lib/conversations-client-access'
import { createSessionNavigationSlice } from './session-navigation'
import { createSessionServerSyncSlice } from './session-server-sync'
import { createConversationPersistenceSlice, forgetServerConversation } from './conversation-persistence'
import { createAnswerRecoverySlice } from './answer-recovery'
import { turnStateFor, withoutUnseenAnswer } from '../lib/turn-selectors'
import { createConversationMetadataSlice } from './conversation-metadata'

export { patchConversationMessageById } from '../lib/conversation-updates'

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
  _appendMessage: (message: ChatMessage, conversationId?: string) => Promise<void>
  _persistCardInteractions: (
    conversationId: string,
    messageId: string,
    cardInteractions: CardInteractions
  ) => Promise<void>
  _persistTurnProvenance: (
    after?: Promise<unknown>,
    turn?: { conversationId: string; turnId: string }
  ) => Promise<void>
  _persistPromptState: (messageId: string, response: string) => Promise<void>
  _persistStageOutput: (conversationId: string, messageId: string, stages: MessageStages) => Promise<void>
  _cutStoppedAnswer: (conversationId: string, messageId: string, turnId: string, shown: string) => Promise<void>
}

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
> = (set, get, store) => ({
  ...initialSessionsState,
  ...createSessionNavigationSlice(set, get, store),
  ...createSessionServerSyncSlice(set, get, store),
  ...createConversationPersistenceSlice(set, get, store),
  ...createAnswerRecoverySlice(set, get, store),
  ...createConversationMetadataSlice(set, get, store),

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

    const turns = Object.fromEntries(
      Object.entries(get().turns).filter(([, view]) => view.conversationId !== conversationId)
    )
    const remaining = currentConversation?.id === conversationId ? null : currentConversation

    set(
      {
        conversations: updatedConversations,
        composerDrafts: nextComposerDrafts,
        currentConversation: remaining,
        unseenAnswers: withoutUnseenAnswer(get().unseenAnswers, conversationId),
        turns,
        ...turnStateFor(turns, remaining?.id),
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
})
