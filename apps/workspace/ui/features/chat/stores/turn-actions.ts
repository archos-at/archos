import { deferChatStorageWrites } from './chat-storage'
import { foldTurnEvents, initialTurnView, stopTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { projectTurn } from '../lib/turn-projection'
import { answerCompletionOf, type AnswerCompletion } from '../lib/answer-analytics'
import { capturePosthog } from '@/lib/analytics/posthog'
import { shownTextOf } from './answer-reveal-store'
import type { ShownAnswer } from '@/adapters/api/wire-v2'
import type { ChatMessage } from '../types'
import { groupByTurn } from '../lib/events-by-turn'
import { runningTurnIn, turnStateFor, withUnseenAnswer } from '../lib/turn-selectors'
import { withConversation } from '../lib/conversation-records'
import type { MessagesGet, MessagesSet, MessagesSlice } from './messages-slice-types'

type StopTurnHandler = (turnId: string, shown: ShownAnswer) => void
let stopTurnHandler: StopTurnHandler | null = null

export const registerStopStreamingHandler = (fn: StopTurnHandler | null): void => {
  stopTurnHandler = fn
}

const reportAnswerCompleted = (completion: AnswerCompletion): void => {
  capturePosthog('answer_completed', { ...completion })
}

export const createTurnActions = (
  set: MessagesSet,
  get: MessagesGet
): Pick<
  MessagesSlice,
  | 'applyTurnEvents'
  | 'beginTurn'
  | 'dropTurn'
  | 'failTurn'
  | 'stopStreaming'
  | 'keepStoppedAnswer'
> => {
  const persistSettled = (conversationId: string, answer: ChatMessage, view: TurnView): void => {
    const appended = Promise.resolve(get()._appendMessage(answer, conversationId))
    const shown = view.shownAtStop
    const cut =
      view.stoppedLate && shown !== undefined
        ? appended.then(() => get()._cutStoppedAnswer(conversationId, answer.id, view.turnId, shown))
        : undefined
    void get()._persistTurnProvenance(cut, { conversationId, turnId: view.turnId })
    get().maybeGenerateConversationName(conversationId)
  }

  const commit = (turns: Record<string, TurnView>, moved: [TurnView, TurnView | undefined][]): void => {
    const state = get()
    const conversations = new Map(state.conversations.map((c) => [c.id, c]))
    if (state.currentConversation) conversations.set(state.currentConversation.id, state.currentConversation)
    const effects: (() => void)[] = []
    let settled = false
    let unseenAnswers = state.unseenAnswers
    for (const [view, previous] of moved) {
      const conversation = conversations.get(view.conversationId)
      if (!conversation) continue
      if (view.phase !== 'running' && previous?.phase === 'running') {
        unseenAnswers = withUnseenAnswer({ ...state, unseenAnswers }, conversation.id, view.phase === 'failed' ? 'failed' : 'answered')
      }
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
      if (prompt) effects.push(() => void get()._appendMessage(prompt, conversation.id))
      const answerId = view.messageId
      if (answerId) for (const stages of stageWrites) effects.push(() => void get()._persistStageOutput(conversation.id, answerId, stages))
    }
    const current = state.currentConversation ? conversations.get(state.currentConversation.id) ?? null : null
    const update = () =>
      set(
        {
          turns,
          unseenAnswers,
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
          ...(view.phase === 'running' && { unseenAnswers: withUnseenAnswer(get(), view.conversationId) }),
          ...(owner && fragment && withConversation(get(), { ...owner, messages: owner.messages.filter((m) => m !== fragment) })),
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
        set(
          {
            turns: { ...get().turns, [turnId]: failed },
            ...(marked.phase === 'running' && { unseenAnswers: withUnseenAnswer(get(), marked.conversationId, 'failed') }),
          },
          false,
          'failTurn:mark'
        )
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
            withConversation(get(), { ...owner, messages: owner.messages.map((m) => (m === fragment ? kept : m)) })),
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
  }
}
