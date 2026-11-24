import type { StateCreator } from 'zustand'
import type { ServerSideListing } from './server-sides'
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
import { liveRunMessages } from '../lib/session-activity'
import { getConversationsClient } from '../lib/conversations-client-access'
import { markConversationErased } from '../lib/erased-conversations'
import type { OwnConversationsDeleted } from '@/adapters/api/conversations-client'
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
  serverSides: Record<string, ServerSideListing>

  pendingMessagesFor: string | null

  setPendingMessagesFor: (conversationId: string | null) => void

  loadServerConversations: (projectId?: string, place?: 'personal' | 'project', wantConversationId?: string) => Promise<void>
  hydrateConversationMessages: (conversationId: string) => Promise<void>
  _lockConversation: (conversationId: string) => void
  setCurrentUser: (userId: string | null) => void
  getUserConversations: () => Conversation[]
  createConversation: () => Conversation
  startNewSessionDraft: () => void
  ensureSession: () => string | undefined
  selectConversation: (conversationId: string) => void
  deleteConversation: (conversationId: string) => Promise<void>
  deleteAllConversations: (side: { projectId: string | null }) => Promise<OwnConversationsDeleted>
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

const forgetErasedConversations = (
  set: Parameters<StateCreator<ChatStore, [['zustand/devtools', never]], [], SessionsSlice>>[0],
  get: () => ChatStore,
  conversationIds: readonly string[],
  action: string
): void => {
  if (conversationIds.length === 0) return
  const erased = new Set(conversationIds)
  for (const id of conversationIds) {
    markConversationErased(id)
    forgetServerConversation(id)
    forgetThreadPosition(id)
  }
  const { conversations, currentConversation, composerDrafts, turns, unseenAnswers } = get()
  const remaining = currentConversation && erased.has(currentConversation.id) ? null : currentConversation
  const keptTurns = Object.fromEntries(Object.entries(turns).filter(([, view]) => !erased.has(view.conversationId)))
  let keptUnseen = unseenAnswers
  for (const id of conversationIds) keptUnseen = withoutUnseenAnswer(keptUnseen, id)
  set(
    {
      conversations: conversations.filter((c) => !erased.has(c.id)),
      composerDrafts: Object.fromEntries(Object.entries(composerDrafts).filter(([id]) => !erased.has(id))),
      currentConversation: remaining,
      unseenAnswers: keptUnseen,
      turns: keptTurns,
      ...turnStateFor(keptTurns, remaining?.id),
      ...(remaining === currentConversation ? {} : { pendingInteraction: null }),
    },
    false,
    action
  )
}

export const initialSessionsState = {
  currentUserId: null as string | null,
  currentConversation: null as Conversation | null,
  conversations: [] as Conversation[],
  isRecoveryPending: false,
  resumableTurn: null as ResumableTurn | null,
  serverConversationsLoaded: false,
  serverSides: {} as Record<string, ServerSideListing>,
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

  deleteConversation: async (conversationId: string) => {
    const conversationsClient = await getConversationsClient()
    await conversationsClient.delete(conversationId)
    const deleted = get().conversations.find((c) => c.id === conversationId)
    if (deleted) cancelLiveRuns([deleted], get().projectId)
    forgetErasedConversations(set, get, [conversationId], 'deleteConversation')
  },

  deleteAllConversations: async (side: { projectId: string | null }) => {
    const conversationsClient = await getConversationsClient()
    const result = await conversationsClient.deleteOwn(side)
    const deleted = new Set(result.deleted)
    cancelLiveRuns(get().conversations.filter((c) => deleted.has(c.id)), side.projectId)
    forgetErasedConversations(set, get, result.deleted, 'deleteAllConversations')
    return result
  },
})
