import type { StateCreator } from 'zustand'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import type { DraftMention } from '@/lib/mentions/mention-text'
import type { WireEvent } from '@/adapters/api/wire-v2'
import type { CardDecision } from '@/features/cards/card-decision'
import type { TurnView } from '@/lib/turns/turn-fold'
import type {
  AnswerExcerpt,
  ChatStore,
  ChatMessage,
  ComposerExcerpt,
  ComposerPrefill,
  ComposerSubject,
  ErrorCode,
} from '../types'

export type ChatSendFn = (
  content: string,
  options?: { reasoningEffort?: ChatEffort; answerExcerpt?: AnswerExcerpt }
) => void

export type MessagesSlice = {
  isStreaming: boolean
  isLoading: boolean
  currentUserMessageId: string | null
  currentTurnStartedAt: number | null
  turns: Record<string, TurnView>
  projectId: string | null
  composerPrefill: ComposerPrefill | null
  composerSubject: ComposerSubject | null
  composerExcerpt: ComposerExcerpt | null
  composerDrafts: Record<string, string>
  chatSendFn: ChatSendFn | null

  applyTurnEvents: (events: readonly WireEvent[]) => void
  beginTurn: (conversationId: string, turnId: string, effort?: ChatEffort) => void
  dropTurn: (turnId: string) => void
  failTurn: (turnId: string) => void
  stopStreaming: () => void
  keepStoppedAnswer: (turnId: string) => void
  respondToPrompt: (messageId: string, response: string) => void
  addUserMessage: (
    content: string,
    metadata?: {
      enabledDataSources?: string[]
      messageFiles?: Array<{ id: string; fileName: string }>
      answerExcerpt?: AnswerExcerpt
    }
  ) => ChatMessage
  adoptRunMessage: (conversationId: string, message: ChatMessage) => void
  patchConversationMessage: (
    conversationId: string,
    messageId: string,
    patch: Partial<ChatMessage>
  ) => void
  setCardDecision: (messageId: string, cardKey: string, decision: CardDecision) => void
  addErrorCard: (code: ErrorCode, message?: string, details?: string) => void
  dismissErrorCard: (messageId: string) => void
  dismissConnectionErrors: () => void
  setProjectId: (projectId: string | null) => void
  setComposerPrefill: (text: string, mentions?: DraftMention[], subject?: ComposerSubject) => void
  setComposerSubject: (subject: ComposerSubject | null) => void
  setComposerExcerpt: (excerpt: ComposerExcerpt | null) => void
  consumeComposerPrefill: () => ComposerPrefill | null
  setChatSendFn: (fn: ChatSendFn | null) => void
  retryLastUserMessage: () => void

  insertRemoteMessages: (
    conversationId: string,
    messages: ChatMessage[],
    options?: { replace?: boolean }
  ) => void

  setComposerDraft: (conversationId: string, text: string) => void
  getComposerDraft: (conversationId: string) => string
  clearComposerDraft: (conversationId: string) => void
}

export type MessagesStateCreator = StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MessagesSlice
>

export type MessagesSet = Parameters<MessagesStateCreator>[0]
export type MessagesGet = Parameters<MessagesStateCreator>[1]
