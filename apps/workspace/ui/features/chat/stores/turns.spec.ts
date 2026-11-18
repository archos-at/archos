import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WireEvent } from '@/adapters/api/wire-v2'
import { wireEvents } from '@/test-utils/wire-v2-fixtures'

vi.mock('@/features/layout/store', () => ({
  useLayoutStore: {
    getState: () => ({ enabledDataSourceIds: [], availableDataSources: [], setEnabledDataSources: vi.fn() }),
  },
}))
vi.mock('@/features/documents/discard-session-resources', () => ({
  discardSessionDocumentsResources: vi.fn(),
}))
const client = vi.hoisted(() => ({
  list: vi.fn().mockResolvedValue([]),
  get: vi.fn().mockResolvedValue(undefined),
  create: vi.fn().mockResolvedValue(undefined),
  listMessages: vi.fn().mockResolvedValue([]),
  createMessage: vi.fn().mockResolvedValue(undefined),
  updateMessageProvenance: vi.fn().mockResolvedValue(undefined),
  updateMessageStages: vi.fn().mockResolvedValue(undefined),
  cutStoppedAnswer: vi.fn().mockResolvedValue(undefined),
  generateTitle: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/adapters/api/conversations-client', () => ({ conversationsClient: client }))
vi.mock('@/lib/analytics/posthog', () => ({ capturePosthog: vi.fn() }))

import { capturePosthog } from '@/lib/analytics/posthog'
import { useChatStore } from '../store'
import { conversationActivity, registerStopStreamingHandler } from './messages-store'
import { endFailedTurn } from '../lib/turn-endings'
import { registerShownText } from './answer-reveal-store'
import type { ChatMessage, Conversation } from '../types'

const answered = wireEvents('turn-answered.jsonl')
const TURN = answered[0]!.turn_id
const CONVERSATION = answered[0]!.conversation_id
const finished = answered.find((event) => event.type === 'RUN_FINISHED')!
const RESULT = finished.type === 'RUN_FINISHED' ? finished.result : undefined!

const upTo = (events: WireEvent[], seq: number) => events.filter((event) => event.seq <= seq)
const from = (events: WireEvent[], seq: number) => events.filter((event) => event.seq >= seq)

const ask = (events: WireEvent[]): { turnId: string; conversationId: string } => {
  const { turn_id: turnId, conversation_id: conversationId } = events[0]!
  const question: ChatMessage = {
    id: turnId,
    role: 'user',
    content: 'Wie lang darf der Fluchtweg sein?',
    timestamp: new Date('2026-09-25T09:00:00.000Z'),
    messageType: 'user',
  }
  const conversation: Conversation = {
    id: conversationId,
    userId: 'user-1',
    title: 'Fluchtweg',
    messages: [question],
    createdAt: new Date('2026-09-25T09:00:00.000Z'),
    updatedAt: new Date('2026-09-25T09:00:00.000Z'),
  }
  useChatStore.setState({ conversations: [conversation], currentConversation: conversation })
  useChatStore.getState().beginTurn(conversationId, turnId)
  return { turnId, conversationId }
}

const messages = () => useChatStore.getState().currentConversation!.messages
const answerOf = (id: string) => messages().find((message) => message.id === id)
const questionOf = (id: string) => messages().find((message) => message.id === id)!

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useChatStore.setState({
    currentUserId: 'user-1',
    conversations: [],
    currentConversation: null,
    turns: {},
    unseenAnswers: {},
    isStreaming: false,
    isLoading: false,
    pendingInteraction: null,
    currentUserMessageId: null,
    currentTurnStartedAt: null,
    composerDrafts: {},
  })
})
afterEach(() => registerStopStreamingHandler(null))

describe('a turn folded into its thread', () => {
  it('is loading until RUN_STARTED acknowledges the question, then streaming', () => {
    ask(answered)
    expect(useChatStore.getState()).toMatchObject({ isStreaming: true, isLoading: true })

    useChatStore.getState().applyTurnEvents(upTo(answered, 1))

    expect(useChatStore.getState()).toMatchObject({ isStreaming: true, isLoading: false })
    expect(messages()).toHaveLength(1)
  })

  it('draws the steps on the question and the prose, masthead and cards on the answer as they arrive', () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(upTo(answered, 15))

    const view = useChatStore.getState().turns[TURN]!
    expect(questionOf(TURN).thinkingSteps).toEqual(view.stepOrder.map((id) => view.steps[id]))
    const answer = answerOf(RESULT.message_id)!
    expect(answer).toMatchObject({ messageType: 'agent_response', isStreaming: true, content: view.text })
    expect(answer.answerMeta).toBeDefined()
    expect(answer.cards?.[0]?.type).toBe('egress_diagram')
  })

  it('keeps a card and an untouched step the same objects across flushes', () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(upTo(answered, 15))
    const card = answerOf(RESULT.message_id)!.cards![0]
    const step = questionOf(TURN).thinkingSteps![0]

    useChatStore.getState().applyTurnEvents(from(upTo(answered, 17), 16))

    expect(answerOf(RESULT.message_id)!.cards![0]).toBe(card)
    expect(questionOf(TURN).thinkingSteps![0]).toBe(step)
  })

  it('settles on the terminal result, persists the answer and the derivation, and lands its stages', async () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(answered)

    const answer = answerOf(RESULT.message_id)!
    expect(answer.isStreaming).toBeUndefined()
    expect(answer.content).toBe(RESULT.text)
    expect(answer.answerConfidence).toBe('high')
    expect(answer.citations).toHaveLength(RESULT.sources!.length)
    expect(answer.cards).toHaveLength(1)
    expect(answer.stages?.followUps).toBeDefined()
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, isLoading: false })

    await vi.waitFor(() => expect(client.createMessage).toHaveBeenCalled())
    expect(client.createMessage.mock.calls.map(([, message]) => message.id)).toContain(RESULT.message_id)
    await vi.waitFor(() =>
      expect(client.updateMessageProvenance).toHaveBeenCalledWith(
        CONVERSATION,
        TURN,
        expect.objectContaining({ thinkingSteps: questionOf(TURN).thinkingSteps })
      )
    )
    await vi.waitFor(() => expect(client.updateMessageStages).toHaveBeenCalled())
    expect(client.updateMessageStages).toHaveBeenCalledWith(
      CONVERSATION,
      RESULT.message_id,
      expect.objectContaining({ followUps: expect.anything() })
    )
  })

  it('stamps how long the turn took when this page sent the question', () => {
    ask(answered)
    useChatStore.setState({ currentTurnStartedAt: Date.now() - 4_000 })
    useChatStore.getState().applyTurnEvents(upTo(answered, 20))
    expect(answerOf(RESULT.message_id)!.answerDurationMs).toBeGreaterThanOrEqual(4_000)
  })

  it('tells PostHog the answer completed once, with the time from send to its terminal event', () => {
    ask(answered)
    useChatStore.setState({ currentTurnStartedAt: Date.now() - 4_000 })
    useChatStore.getState().applyTurnEvents(answered)
    useChatStore.getState().applyTurnEvents(answered)

    const completed = vi.mocked(capturePosthog).mock.calls.filter(([event]) => event === 'answer_completed')
    expect(completed).toHaveLength(1)
    const properties = completed[0]![1] as { message_id: string; duration_ms: number; outcome: string }
    expect(properties).toMatchObject({ message_id: RESULT.message_id, outcome: 'ok' })
    expect(properties.duration_ms).toBeGreaterThanOrEqual(4_000)
    expect(properties.duration_ms).toBeLessThan(60_000)
  })

  it('records the Aufwand the question was sent with on its answer, and mirrors it', async () => {
    ask(answered)
    useChatStore.getState().beginTurn(CONVERSATION, TURN, 'low')
    useChatStore.getState().applyTurnEvents(answered)

    expect(answerOf(RESULT.message_id)!.reasoningEffort).toBe('low')
    await vi.waitFor(() =>
      expect(client.updateMessageProvenance).toHaveBeenCalledWith(
        CONVERSATION,
        RESULT.message_id,
        expect.objectContaining({ reasoningEffort: 'low' })
      )
    )
  })

  it('records no Aufwand for a turn this page did not open with one', () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(answered)
    expect(answerOf(RESULT.message_id)!.reasoningEffort).toBeUndefined()
  })

  it('stores the follow-ups but does not draw them under a reader who is typing', async () => {
    ask(answered)
    useChatStore.setState({ composerDrafts: { [CONVERSATION]: 'Und bei GK 5?' } })
    useChatStore.getState().applyTurnEvents(answered)

    expect(answerOf(RESULT.message_id)!.stages?.followUps).toBeUndefined()
    await vi.waitFor(() => expect(client.updateMessageStages).toHaveBeenCalled())
  })

  it('takes back a retracted round and settles on the result', () => {
    const events = wireEvents('turn-retracted.jsonl')
    const { turnId } = ask(events)
    useChatStore.getState().applyTurnEvents(upTo(events, 3))
    const id = useChatStore.getState().turns[turnId]!.messageId!
    expect(answerOf(id)!.content).not.toBe('')

    useChatStore.getState().applyTurnEvents(from(upTo(events, 4), 4))
    expect(answerOf(id)!.content).toBe('')

    useChatStore.getState().applyTurnEvents(from(events, 5))
    expect(answerOf(id)).toMatchObject({ answerConfidence: 'low', answerConfidenceCappedReason: 'ungrounded' })
    expect(answerOf(id)!.citationsRemoved).toEqual({ count: 1, reasons: ['no_matching_passage'] })
  })
})

describe('Stop', () => {
  const cancelled = wireEvents('turn-cancelled.jsonl')

  it('sends cancel_turn and keeps the answer so far, marked stopped, with the composer free', () => {
    const { turnId } = ask(cancelled)
    const cancel = vi.fn()
    registerStopStreamingHandler(cancel)
    useChatStore.getState().applyTurnEvents(upTo(cancelled, 4))
    const id = useChatStore.getState().turns[turnId]!.messageId!
    const partial = answerOf(id)!.content

    useChatStore.getState().stopStreaming()

    expect(cancel).toHaveBeenCalledWith(turnId, { seq: 4, chars: Array.from(partial).length })
    expect(answerOf(id)).toMatchObject({ content: partial.trim(), stopped: true })
    expect(answerOf(id)!.isStreaming).toBeUndefined()
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(client.createMessage).not.toHaveBeenCalled()
  })

  it("persists the server's cancelled terminal as the stopped answer", async () => {
    const { turnId } = ask(cancelled)
    useChatStore.getState().applyTurnEvents(cancelled)
    const id = useChatStore.getState().turns[turnId]!.messageId!

    expect(answerOf(id)!.stopped).toBe(true)
    await vi.waitFor(() =>
      expect(client.createMessage).toHaveBeenCalledWith(CONVERSATION_OF(cancelled), expect.objectContaining({ id }))
    )
  })
})

const CONVERSATION_OF = (events: WireEvent[]) => events[0]!.conversation_id

describe('Stop, what was on screen', () => {
  const cancelled = wireEvents('turn-cancelled.jsonl')
  const delta = cancelled.find((event) => event.type === 'TEXT_MESSAGE_CONTENT')!
  const terminal = cancelled.find((event) => event.type === 'RUN_FINISHED')!

  it('keeps the shown text, and takes neither later deltas nor the terminal’s text, sources or cards', async () => {
    const { turnId } = ask(cancelled)
    useChatStore.getState().applyTurnEvents(upTo(cancelled, 4))
    const id = useChatStore.getState().turns[turnId]!.messageId!
    const arrived = answerOf(id)!.content
    const shown = arrived.slice(0, arrived.indexOf(' ', 10) + 1)
    const unregister = registerShownText(id, () => shown)
    const cancel = vi.fn()
    registerStopStreamingHandler(cancel)

    useChatStore.getState().stopStreaming()
    unregister()
    expect(answerOf(id)!.content).toBe(shown.trim())
    expect(cancel).toHaveBeenCalledWith(turnId, { seq: 4, chars: shown.length })

    const late = { ...delta, seq: 5, delta: ' und noch mehr' } as WireEvent
    const finishedEvent =
      terminal.type === 'RUN_FINISHED'
        ? ({
            ...terminal,
            seq: 6,
            result: { ...terminal.result, text: `${arrived} und noch mehr.`, sources: RESULT.sources, cards: RESULT.cards },
          } as WireEvent)
        : terminal
    useChatStore.getState().applyTurnEvents([late, finishedEvent])

    const answer = answerOf(id)!
    expect(answer).toMatchObject({ content: shown.trim(), stopped: true })
    expect(answer.cards).toBeUndefined()
    expect(answer.citations).toBeUndefined()
    await vi.waitFor(() =>
      expect(client.createMessage).toHaveBeenCalledWith(
        CONVERSATION_OF(cancelled),
        expect.objectContaining({ id, content: shown.trim() })
      )
    )
    expect(client.cutStoppedAnswer).not.toHaveBeenCalled()
  })

  describe('when the Stop crossed the finished answer', () => {
    const settled = RESULT.text.slice(0, RESULT.text.indexOf('[[card:1]]'))
    const stopBeforeTheTerminal = (): { turnId: string; conversationId: string; id: string } => {
      const opened = ask(answered)
      useChatStore.getState().applyTurnEvents(upTo(answered, finished.seq - 1))
      const id = useChatStore.getState().turns[opened.turnId]!.messageId!
      expect(useChatStore.getState().turns[opened.turnId]!.text.startsWith(settled)).toBe(true)
      const unregister = registerShownText(id, () => settled)
      registerStopStreamingHandler(vi.fn())
      useChatStore.getState().stopStreaming()
      unregister()
      return { ...opened, id }
    }

    it('keeps the cut answer, stores it, then asks the BFF to cut the server’s row to what was shown', async () => {
      const { turnId, conversationId, id } = stopBeforeTheTerminal()

      useChatStore.getState().applyTurnEvents(from(answered, finished.seq))

      const answer = answerOf(id)!
      expect(answer).toMatchObject({ content: settled.trim(), stopped: true })
      expect(answer.cards).toBeUndefined()
      await vi.waitFor(() =>
        expect(client.cutStoppedAnswer).toHaveBeenCalledWith(conversationId, id, { turnId, shown: settled })
      )
      expect(client.createMessage.mock.invocationCallOrder[0]).toBeLessThan(
        client.cutStoppedAnswer.mock.invocationCallOrder[0]!
      )
      expect(client.createMessage).toHaveBeenCalledWith(
        conversationId,
        expect.objectContaining({ id, content: settled.trim(), metadata: expect.objectContaining({ provenance: { stopped: true } }) })
      )      // And before the provenance mirror, whose stopped mark would otherwise
      await vi.waitFor(() =>
        expect(client.updateMessageProvenance).toHaveBeenCalledWith(conversationId, id, expect.objectContaining({ stopped: true }))
      )
      const provenanceOfAnswer = client.updateMessageProvenance.mock.calls.findIndex(([, messageId]) => messageId === id)
      expect(client.cutStoppedAnswer.mock.invocationCallOrder[0]).toBeLessThan(
        client.updateMessageProvenance.mock.invocationCallOrder[provenanceOfAnswer]!
      )
    })

    it('without a terminal (the server answered the Stop with turn_not_found), stores and cuts what is on screen', async () => {
      const { turnId, conversationId, id } = stopBeforeTheTerminal()

      useChatStore.getState().keepStoppedAnswer(turnId)

      await vi.waitFor(() =>
        expect(client.cutStoppedAnswer).toHaveBeenCalledWith(conversationId, id, { turnId, shown: settled })
      )
      expect(client.createMessage).toHaveBeenCalledWith(conversationId, expect.objectContaining({ id, content: settled.trim() }))
    })

    it('does nothing more for a turn whose terminal this page folded', async () => {
      const { turnId } = stopBeforeTheTerminal()
      useChatStore.getState().applyTurnEvents(from(answered, finished.seq))
      await vi.waitFor(() => expect(client.cutStoppedAnswer).toHaveBeenCalledTimes(1))

      useChatStore.getState().keepStoppedAnswer(turnId)

      expect(client.cutStoppedAnswer).toHaveBeenCalledTimes(1)
    })
  })
})

describe('a turn that fails mid-answer', () => {
  const failure = wireEvents('turn-error.jsonl').find((event) => event.type === 'RUN_ERROR')!
  const failAt = (seq: number) =>
    ({ ...failure, seq, turn_id: TURN, conversation_id: CONVERSATION }) as WireEvent

  it('keeps the partial answer, marked failed and no longer streaming, and forgets the turn', () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(upTo(answered, 14))
    const partial = answerOf(RESULT.message_id)!.content
    expect(partial.length).toBeGreaterThan(0)

    useChatStore.getState().applyTurnEvents([failAt(15)])
    expect(answerOf(RESULT.message_id)).toMatchObject({ content: partial, failed: true })
    expect(answerOf(RESULT.message_id)!.isStreaming).toBeUndefined()

    useChatStore.getState().failTurn(TURN)
    expect(answerOf(RESULT.message_id)).toMatchObject({ content: partial, failed: true })
    expect(useChatStore.getState().turns[TURN]).toBeUndefined()
    expect(useChatStore.getState().isStreaming).toBe(false)
  })

  it('marks a still-streaming answer failed when the turn is ended from outside the fold', () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(upTo(answered, 14))
    useChatStore.getState().failTurn(TURN)
    expect(answerOf(RESULT.message_id)).toMatchObject({ failed: true })
    expect(answerOf(RESULT.message_id)!.isStreaming).toBeUndefined()
  })

  it('shows a turn ended from outside the fold as failed before it forgets it, as RUN_ERROR does', () => {
    ask(answered)
    const phases: (string | undefined)[] = []
    const unsubscribe = useChatStore.subscribe((state) => phases.push(state.turns[TURN]?.phase))

    useChatStore.getState().failTurn(TURN)
    unsubscribe()

    expect(phases).toEqual(['failed', undefined])
    expect(useChatStore.getState()).toMatchObject({ isStreaming: false, isLoading: false })
  })

  it('makes way for the retry: the failed words go, the question is sent again', () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents([...upTo(answered, 14), failAt(15)])
    useChatStore.getState().failTurn(TURN)
    const send = vi.fn()
    useChatStore.setState({ chatSendFn: send })

    useChatStore.getState().retryLastUserMessage()

    expect(answerOf(RESULT.message_id)).toBeUndefined()
    expect(send).toHaveBeenCalledWith('Wie lang darf der Fluchtweg sein?')
  })
})

describe('a question for the asker, then a run', () => {
  const hitl = wireEvents('turn-hitl-handoff.jsonl')

  it('opens a prompt card and the pending question, and closes the question when it is resolved', async () => {
    const { turnId } = ask(hitl)
    useChatStore.getState().applyTurnEvents(upTo(hitl, 4))

    const prompt = messages().find((message) => message.messageType === 'prompt')!
    expect(prompt).toMatchObject({ promptId: 'ask_01J9Z6', promptParentId: turnId, promptInputType: 'choice' })
    expect(prompt.promptOptions?.[0]).toEqual({ id: '1', label: expect.any(String) })
    expect(useChatStore.getState().pendingInteraction).toEqual({
      turnId,
      interactionId: 'ask_01J9Z6',
      input: 'choice',
    })
    expect(useChatStore.getState().isStreaming).toBe(false)
    await vi.waitFor(() =>
      expect(client.createMessage).toHaveBeenCalledWith(CONVERSATION_OF(hitl), expect.objectContaining({ id: prompt.id }))
    )

    useChatStore.getState().applyTurnEvents(from(upTo(hitl, 6), 5))
    expect(useChatStore.getState().pendingInteraction).toBeNull()
    expect(useChatStore.getState().isStreaming).toBe(true)
  })

  it('draws the run’s block, not an answer, for a turn that handed off to a run', () => {
    ask(hitl)
    useChatStore.getState().applyTurnEvents(hitl)
    const responses = messages().filter((message) => message.messageType === 'agent_response')
    expect(responses).toHaveLength(1)
    expect(responses[0]!.runLedger).toBeDefined()
    expect(responses[0]!.content).toBe('')
    expect(useChatStore.getState().isStreaming).toBe(false)
  })
})

describe('a turn in a chat the reader left', () => {
  const hitl = wireEvents('turn-hitl-handoff.jsonl')
  const OTHER = 'conv-other'

  const leave = () => {
    const other: Conversation = {
      id: OTHER,
      userId: 'user-1',
      title: 'Stellplätze',
      messages: [],
      createdAt: new Date('2026-09-25T09:05:00.000Z'),
      updatedAt: new Date('2026-09-25T09:05:00.000Z'),
    }
    useChatStore.setState((state) => ({ conversations: [...state.conversations, other] }))
    useChatStore.getState().selectConversation(OTHER)
  }
  const left = (conversationId: string) =>
    useChatStore.getState().conversations.find((conversation) => conversation.id === conversationId)!
  const activity = (conversationId: string) => {
    const { turns, unseenAnswers } = useChatStore.getState()
    return conversationActivity(turns, unseenAnswers, conversationId)
  }

  it('keeps folding into its own thread, settles there whole, and is stored under its own conversation', async () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(upTo(answered, 9))
    leave()
    expect(useChatStore.getState().isStreaming).toBe(false)
    expect(activity(CONVERSATION)).toBe('working')

    useChatStore.getState().applyTurnEvents(from(answered, 10))

    const answer = left(CONVERSATION).messages.find((message) => message.id === RESULT.message_id)!
    expect(answer).toMatchObject({ messageType: 'agent_response', content: RESULT.text })
    expect(answer.isStreaming).toBeFalsy()
    expect(messages()).toEqual([])
    expect(useChatStore.getState().isStreaming).toBe(false)
    await vi.waitFor(() =>
      expect(client.createMessage).toHaveBeenCalledWith(CONVERSATION, expect.objectContaining({ id: RESULT.message_id }))
    )
    for (const call of [...client.createMessage.mock.calls, ...client.updateMessageProvenance.mock.calls]) {
      expect(call[0]).toBe(CONVERSATION)
    }
  })

  it('is marked as answered until the reader opens that chat, and never for the chat that is open', () => {
    ask(answered)
    leave()
    useChatStore.getState().applyTurnEvents(answered)
    expect(activity(CONVERSATION)).toBe('answered')
    expect(activity(OTHER)).toBeNull()

    useChatStore.getState().selectConversation(CONVERSATION)
    expect(activity(CONVERSATION)).toBeNull()

    useChatStore.setState({ turns: {} })
    ask(answered)
    useChatStore.getState().applyTurnEvents(answered)
    expect(activity(CONVERSATION)).toBeNull()
  })

  it('files a question for the asker in its own thread and reads as waiting, not working', async () => {
    const { turnId, conversationId } = ask(hitl)
    leave()
    useChatStore.getState().applyTurnEvents(upTo(hitl, 4))

    const prompt = left(conversationId).messages.find((message) => message.messageType === 'prompt')!
    expect(prompt).toMatchObject({ promptParentId: turnId })
    expect(messages()).toEqual([])
    expect(useChatStore.getState().pendingInteraction).toBeNull()
    expect(activity(conversationId)).toBe('waiting')
    await vi.waitFor(() =>
      expect(client.createMessage).toHaveBeenCalledWith(conversationId, expect.objectContaining({ id: prompt.id }))
    )

    useChatStore.getState().selectConversation(conversationId)
    expect(useChatStore.getState().pendingInteraction).toMatchObject({ turnId })
  })

  it('is marked as answered when it fails, and its error card lands in its own thread', async () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(upTo(answered, 9))
    leave()

    endFailedTurn(useChatStore.getState().turns[TURN]!, { code: 'agent.no_response' })

    expect(activity(CONVERSATION)).toBe('answered')
    await vi.waitFor(() =>
      expect(left(CONVERSATION).messages.at(-1)).toMatchObject({ errorData: { errorCode: 'agent.no_response' } })
    )
    expect(messages()).toEqual([])
  })
})

describe('a turn this tab cannot continue', () => {
  it('is dropped with its unfinished answer', () => {
    ask(answered)
    useChatStore.getState().applyTurnEvents(upTo(answered, 14))
    expect(answerOf(RESULT.message_id)).toBeDefined()

    useChatStore.getState().dropTurn(TURN)

    expect(answerOf(RESULT.message_id)).toBeUndefined()
    expect(useChatStore.getState().turns[TURN]).toBeUndefined()
    expect(useChatStore.getState().isStreaming).toBe(false)
  })
})
