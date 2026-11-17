import { v4 as uuidv4 } from 'uuid'
import type { StateCreator } from 'zustand'
import type {
  ChatStore,
  ChatMessage,
  ComposerPrefill,
  ComposerSubject,
  ErrorCode,
  Conversation,
  PendingInteraction,
} from '../types'
import type { DraftMention } from '@/lib/mentions/mention-text'
import type { ShownAnswer, WireEvent } from '@/adapters/api/wire-v2'
import { deferChatStorageWrites } from './chat-storage'
import { withErrorMessage } from './connection-errors'
import type { CardDecision, CardInteractions } from '@/features/cards/card-decision'
import { errorConcernsTheThread, getErrorMeta } from '../lib/error-registry'
import { foldTurnEvents, initialTurnView, stopTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { projectTurn } from '../lib/turn-projection'
import { answerCompletionOf, type AnswerCompletion } from '../lib/answer-analytics'
import { capturePosthog } from '@/lib/analytics/posthog'
import { shownTextOf } from './answer-reveal-store'
import { useLayoutStore } from '@/features/layout/store'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'

export type ChatSendFn = (content: string, options?: { reasoningEffort?: ChatEffort }) => void

export type MessagesSlice = {
  isStreaming: boolean
  isLoading: boolean
  currentUserMessageId: string | null
  currentTurnStartedAt: number | null
  turns: Record<string, TurnView>
  projectId: string | null
  composerPrefill: ComposerPrefill | null
  composerSubject: ComposerSubject | null
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

type StopTurnHandler = (turnId: string, shown: ShownAnswer) => void
let stopTurnHandler: StopTurnHandler | null = null

export const registerStopStreamingHandler = (fn: StopTurnHandler | null): void => {
  stopTurnHandler = fn
}

const generateTitle = (content: string): string => {
  const maxLength = 50
  const trimmed = content.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return trimmed.substring(0, maxLength) + '...'
}

const updateConversationInList = (
  conversations: Conversation[],
  updatedConversation: Conversation
): Conversation[] => {
  return conversations.map((c) => (c.id === updatedConversation.id ? updatedConversation : c))
}

const messageTime = (message: ChatMessage): number => {
  const value = message.timestamp
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

const compareThreadOrder = (a: ChatMessage, b: ChatMessage): number => {
  const byTime = messageTime(a) - messageTime(b)
  if (byTime !== 0) return byTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

const withServerFacts = (local: ChatMessage, remote: ChatMessage): ChatMessage => {
  const patch: Partial<ChatMessage> = {}

  if (messageTime(remote) !== messageTime(local)) patch.timestamp = remote.timestamp
  if (remote.authorUserId && remote.authorUserId !== local.authorUserId) {
    patch.authorUserId = remote.authorUserId
  }
  if (remote.authorName && remote.authorName !== local.authorName)
    patch.authorName = remote.authorName
  if (remote.authorAvatarUrl && remote.authorAvatarUrl !== local.authorAvatarUrl) {
    patch.authorAvatarUrl = remote.authorAvatarUrl
  }
  if (remote.mentions && !local.mentions) patch.mentions = remote.mentions
  if (remote.addressees && !local.addressees) patch.addressees = remote.addressees
  if (remote.runLedger && (!local.runLedger || remote.runLedger.updatedAt > local.runLedger.updatedAt)) {
    patch.runLedger = remote.runLedger
  }

  return Object.keys(patch).length === 0 ? local : { ...local, ...patch }
}

export const mergeRemoteMessages = (
  local: ChatMessage[],
  remote: ChatMessage[],
  replace: boolean
): { messages: ChatMessage[]; added: boolean } => {
  const localById = new Map(local.map((message) => [message.id, message]))

  let changed = false
  let added = false
  const reconciled = remote.map((message) => {
    const existing = localById.get(message.id)
    if (!existing) {
      changed = true
      added = true
      return message
    }
    const merged = withServerFacts(existing, message)
    if (merged !== existing) changed = true
    return merged
  })

  const remoteIds = new Set(remote.map((message) => message.id))
  const localOnly = local.filter((message) => !remoteIds.has(message.id))

  const newestRemoteTime = remote.reduce(
    (newest, message) => Math.max(newest, messageTime(message)),
    0
  )
  const keptLocalOnly =
    replace && remote.length > 0
      ? localOnly.filter(
          (message) => message.isStreaming || messageTime(message) >= newestRemoteTime
        )
      : localOnly
  if (keptLocalOnly.length !== localOnly.length) changed = true

  if (!changed) return { messages: local, added: false }

  return { messages: [...reconciled, ...keptLocalOnly].sort(compareThreadOrder), added }
}

const reportAnswerCompleted = (completion: AnswerCompletion): void => {
  capturePosthog('answer_completed', { ...completion })
}

const createNewConversation = (userId: string): Conversation => ({
  id: `s_${uuidv4().replace(/-/g, '_')}`,
  userId,
  title: '',
  messages: [],
  createdAt: new Date(),
  updatedAt: new Date(),
})

export const runningTurnIn = (
  turns: Record<string, TurnView>,
  conversationId: string | undefined
): TurnView | undefined =>
  conversationId
    ? Object.values(turns).find((view) => view.conversationId === conversationId && view.phase === 'running')
    : undefined

export const turnStateFor = (
  turns: Record<string, TurnView>,
  conversationId: string | undefined
): { isStreaming: boolean; isLoading: boolean; pendingInteraction: PendingInteraction | null } => {
  const view = runningTurnIn(turns, conversationId)
  const request = view?.interaction
  return {
    isStreaming: Boolean(view && !request),
    isLoading: view?.lastSeq === 0,
    pendingInteraction: view && request
      ? { turnId: view.turnId, interactionId: request.interaction_id, input: request.input }
      : null,
  }
}

const groupByTurn = (events: readonly WireEvent[]): Map<string, WireEvent[]> => {
  const byTurn = new Map<string, WireEvent[]>()
  for (const event of events) {
    const list = byTurn.get(event.turn_id)
    if (list) list.push(event)
    else byTurn.set(event.turn_id, [event])
  }
  return byTurn
}

export const initialMessagesState = {
  isStreaming: false,
  isLoading: false,
  currentUserMessageId: null as string | null,
  currentTurnStartedAt: null as number | null,
  turns: {} as Record<string, TurnView>,
  projectId: null as string | null,
  composerPrefill: null as ComposerPrefill | null,
  composerSubject: null,
  composerDrafts: {} as Record<string, string>,
  chatSendFn: null as ChatSendFn | null,
}

export const createMessagesSlice: StateCreator<
  ChatStore,
  [['zustand/devtools', never]],
  [],
  MessagesSlice
> = (set, get) => {
  const withConversation = (conversation: Conversation) => {
    const { conversations, currentConversation } = get()
    return {
      conversations: updateConversationInList(conversations, conversation),
      ...(currentConversation?.id === conversation.id && { currentConversation: conversation }),
    }
  }

  const persistSettled = (conversationId: string, answer: ChatMessage, view: TurnView): void => {
    if (get().currentConversation?.id !== conversationId) return
    const appended = Promise.resolve(get()._appendMessage(answer))
    const shown = view.shownAtStop
    const cut =
      view.stoppedLate && shown !== undefined
        ? appended.then(() => get()._cutStoppedAnswer(conversationId, answer.id, view.turnId, shown))
        : undefined
    void get()._persistTurnProvenance(cut)
    get().maybeGenerateConversationName(conversationId)
  }

  const commit = (turns: Record<string, TurnView>, moved: [TurnView, TurnView | undefined][]): void => {
    const state = get()
    const conversations = new Map(state.conversations.map((c) => [c.id, c]))
    if (state.currentConversation) conversations.set(state.currentConversation.id, state.currentConversation)
    const effects: (() => void)[] = []
    let settled = false
    for (const [view, previous] of moved) {
      const conversation = conversations.get(view.conversationId)
      if (!conversation) continue
      const answerDurationMs =
        state.currentUserMessageId === view.turnId && state.currentTurnStartedAt !== null
          ? Math.max(1, Date.now() - state.currentTurnStartedAt)
          : undefined
      const projection = projectTurn(conversation.messages, view, previous, {
        answerDurationMs,
        draft: state.composerDrafts[conversation.id] ?? '',
      })
      const completion =
        state.currentUserMessageId === view.turnId
          ? answerCompletionOf(
              view,
              previous,
              projection.messages.find((message) => message.id === view.messageId),
              answerDurationMs
            )
          : null
      if (completion) effects.push(() => reportAnswerCompleted(completion))
      if (projection.messages === conversation.messages && !projection.settled) continue
      conversations.set(conversation.id, {
        ...conversation,
        messages: projection.messages,
        ...(projection.settled && { updatedAt: new Date() }),
      })
      const { settled: answer, prompt, stageWrites } = projection
      if (answer) {
        settled = true
        effects.push(() => persistSettled(conversation.id, answer, view))
      }
      if (prompt) effects.push(() => void get()._appendMessage(prompt))
      const answerId = view.messageId
      if (answerId) for (const stages of stageWrites) effects.push(() => void get()._persistStageOutput(conversation.id, answerId, stages))
    }
    const current = state.currentConversation ? conversations.get(state.currentConversation.id) ?? null : null
    const update = () =>
      set(
        {
          turns,
          conversations: state.conversations.map((c) => conversations.get(c.id) ?? c),
          currentConversation: current,
          ...turnStateFor(turns, current?.id),
        },
        false,
        'applyTurnEvents'
      )
    if (settled) deferChatStorageWrites(update)
    else update()
    for (const effect of effects) effect()
  }

  return {
    ...initialMessagesState,

    applyTurnEvents: (events) => {
      let turns = get().turns
      const moved: [TurnView, TurnView | undefined][] = []
      for (const [turnId, list] of groupByTurn(events)) {
        const previous = turns[turnId]
        const view = foldTurnEvents(previous, list)
        if (!view || view === previous) continue
        turns = { ...turns, [turnId]: view }
        moved.push([view, previous])
      }
      if (moved.length > 0) commit(turns, moved)
    },

    beginTurn: (conversationId, turnId, effort) => {
      const view = initialTurnView(turnId, conversationId)
      const turns = { ...get().turns, [turnId]: effort ? { ...view, effort } : view }
      set(
        {
          turns,
          currentUserMessageId: turnId,
          ...(get().resumableTurn?.turnId === turnId && { resumableTurn: null }),
          ...turnStateFor(turns, get().currentConversation?.id),
        },
        false,
        'beginTurn'
      )
    },

    dropTurn: (turnId) => {
      const { turns, currentConversation, conversations } = get()
      const view = turns[turnId]
      if (!view) return
      const { [turnId]: _dropped, ...rest } = turns
      const owner =
        currentConversation?.id === view.conversationId
          ? currentConversation
          : conversations.find((c) => c.id === view.conversationId)
      const fragment = owner?.messages.find((m) => m.id === view.messageId && m.isStreaming)
      set(
        {
          turns: rest,
          ...(owner && fragment && withConversation({ ...owner, messages: owner.messages.filter((m) => m !== fragment) })),
          ...turnStateFor(rest, currentConversation?.id),
        },
        false,
        'dropTurn'
      )
    },

    failTurn: (turnId) => {
      const marked = get().turns[turnId]
      if (!marked) return
      if (marked.phase !== 'failed') {
        const failed: TurnView = { ...marked, phase: 'failed' }
        const { currentUserMessageId, currentTurnStartedAt, currentConversation: open } = get()
        const completion =
          currentUserMessageId === turnId
            ? answerCompletionOf(
                failed,
                marked,
                open?.messages.find((message) => message.id === marked.messageId),
                currentTurnStartedAt === null ? undefined : Math.max(1, Date.now() - currentTurnStartedAt)
              )
            : null
        set({ turns: { ...get().turns, [turnId]: failed } }, false, 'failTurn:mark')
        if (completion) reportAnswerCompleted(completion)
      }
      const { turns, currentConversation, conversations } = get()
      const view = turns[turnId]
      if (!view) return
      const { [turnId]: _failed, ...rest } = turns
      const owner =
        currentConversation?.id === view.conversationId
          ? currentConversation
          : conversations.find((c) => c.id === view.conversationId)
      const fragment = owner?.messages.find((m) => m.id === view.messageId && !m.failed)
      const kept: ChatMessage | undefined = fragment && { ...fragment, isStreaming: undefined, failed: true }
      set(
        {
          turns: rest,
          ...(owner &&
            kept &&
            withConversation({ ...owner, messages: owner.messages.map((m) => (m === fragment ? kept : m)) })),
          ...turnStateFor(rest, currentConversation?.id),
        },
        false,
        'failTurn'
      )
    },

    stopStreaming: () => {
      const view = runningTurnIn(get().turns, get().currentConversation?.id)
      if (!view) return
      const { view: stopped, shown } = stopTurnView(view, view.messageId ? shownTextOf(view.messageId) : undefined)
      commit({ ...get().turns, [view.turnId]: stopped }, [[stopped, view]])
      stopTurnHandler?.(view.turnId, shown)
    },

    keepStoppedAnswer: (turnId) => {
      const view = get().turns[turnId]
      const conversation = get().currentConversation
      if (!view || view.result || view.outcome !== 'cancelled' || view.shownAtStop === undefined) return
      if (!view.messageId || conversation?.id !== view.conversationId) return
      const answer = conversation.messages.find((message) => message.id === view.messageId)
      if (!answer) return
      const shown = view.shownAtStop
      void Promise.resolve(get()._appendMessage(answer)).then(() =>
        get()._cutStoppedAnswer(conversation.id, answer.id, turnId, shown)
      )
    },

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

    setComposerPrefill: (text: string, mentions?: DraftMention[], subject?: ComposerSubject) => {
      const prefill: ComposerPrefill =
        mentions && mentions.length > 0 ? { text, mentions, subject } : { text, subject }
      set(
        {
          composerPrefill: prefill,
          ...(subject !== undefined ? { composerSubject: subject ?? null } : {}),
        },
        false,
        'setComposerPrefill'
      )
    },

    setComposerSubject: (subject: ComposerSubject | null) => {
      set({ composerSubject: subject }, false, 'setComposerSubject')
    },

    consumeComposerPrefill: () => {
      const { composerPrefill } = get()
      if (composerPrefill === null) return null
      set({ composerPrefill: null }, false, 'consumeComposerPrefill')
      return composerPrefill
    },

    setChatSendFn: (fn) => {
      set({ chatSendFn: fn }, false, 'setChatSendFn')
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
          withConversation({ ...currentConversation, messages: messages.filter((msg) => !failed.includes(msg)) }),
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

    setComposerDraft: (conversationId: string, text: string) => {
      const { composerDrafts } = get()
      const current = composerDrafts[conversationId]

      if (text === '') {
        if (current === undefined) return
        const next = { ...composerDrafts }
        delete next[conversationId]
        set({ composerDrafts: next }, false, 'setComposerDraft:clear')
        return
      }

      if (current === text) return
      set(
        { composerDrafts: { ...composerDrafts, [conversationId]: text } },
        false,
        'setComposerDraft'
      )
    },

    getComposerDraft: (conversationId: string) => {
      return get().composerDrafts[conversationId] ?? ''
    },

    clearComposerDraft: (conversationId: string) => {
      const { composerDrafts } = get()
      if (!(conversationId in composerDrafts)) return
      const next = { ...composerDrafts }
      delete next[conversationId]
      set({ composerDrafts: next }, false, 'clearComposerDraft')
    },
  }
}
