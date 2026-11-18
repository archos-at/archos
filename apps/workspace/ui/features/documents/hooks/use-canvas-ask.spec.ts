import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  registerCanvasChatSender,
  registerCanvasChatSteerer,
  type CanvasChatQuestion,
  type CanvasChatSteer,
} from '@/features/chat/lib/canvas-bridge'
import { initialTurnView, type TurnView } from '@/lib/turns/turn-fold'
import { useChatStore } from '@/features/chat/store'
import type { CanvasQuestion, CanvasTurnClient, CanvasTurnClientOptions } from '../lib/canvas-turn-client'
import { askRegionOf, statusOf, useCanvasAsk, type UseCanvasAskOptions } from './use-canvas-ask'

const REGION = { page: 1, x: 0.1, y: 0.2, w: 0.3, h: 0.2 }

function fakeClients() {
  type Steered = { text: string; region: unknown; onLeftover?: (text: string) => void }
  const made: Array<{
    options: CanvasTurnClientOptions
    asked: Array<{ question: CanvasQuestion; turnId: string }>
    steered: Steered[]
  }> = []
  const createClient = (options: CanvasTurnClientOptions): CanvasTurnClient => {
    const record = { options, asked: [] as Array<{ question: CanvasQuestion; turnId: string }>, steered: [] as Steered[] }
    made.push(record)
    return {
      conversationId: options.conversationId,
      ensureConversation: async () => {},
      ask: async (question, turnId) => {
        record.asked.push({ question, turnId })
        options.onTurn(initialTurnView(turnId, options.conversationId))
      },
      cancel: vi.fn(),
      steer: (text, steerOptions) => {
        record.steered.push({ text, region: steerOptions?.region ?? null, onLeftover: steerOptions?.onLeftover })
        return true
      },
      close: vi.fn(),
    }
  }
  return { made, createClient }
}

const finished = (turnId: string, text: string): TurnView => ({
  ...initialTurnView(turnId, 'conv'),
  phase: 'finished',
  outcome: 'answered',
  text,
})

const resolveThread = vi.fn(async (documentId: string) => `s_thread_${documentId}`)

const hook = (options: Partial<UseCanvasAskOptions> & Pick<UseCanvasAskOptions, 'createClient'>) =>
  renderHook((props: Partial<UseCanvasAskOptions>) =>
    useCanvasAsk({
      documentId: 'doc_1',
      enabled: true,
      projectId: 'proj_1',
      fileName: 'Grundriss.pdf',
      resolveThread,
      ...options,
      ...props,
    })
  )

const flush = () => act(async () => {})

beforeEach(() => {
  resolveThread.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('asking the agent on the canvas', () => {
  it('turns a composing card into a question, and follows its turn to the answer', async () => {
    const { made, createClient } = fakeClients()
    const { result } = hook({ createClient })

    let composing = ''
    act(() => {
      composing = result.current.compose(REGION)
    })
    expect(result.current.openId).toBe(composing)
    expect(result.current.asks[0]).toMatchObject({ status: 'composing', region: REGION })

    let asked = ''
    act(() => {
      asked = result.current.ask({ id: composing, text: 'Was ist das?', region: REGION, intent: 'what' })
    })
    await flush()
    expect(result.current.asks).toHaveLength(1)
    expect(result.current.asks[0]).toMatchObject({ id: asked, status: 'thinking', backend: 'canvas', intent: 'what' })
    expect(result.current.openId).toBe(asked)
    expect(made[0].asked[0]).toMatchObject({ turnId: asked, question: { text: 'Was ist das?', region: REGION } })
    expect(made[0].options.title).toBe('Grundriss.pdf · Review')

    act(() => made[0].options.onTurn(finished(asked, 'Eine Brandschutztür.')))
    expect(result.current.asks[0]).toMatchObject({ status: 'answered', view: { text: 'Eine Brandschutztür.' } })
  })

  it('asks in the person’s own thread about the document, the one the server keeps', async () => {
    const first = fakeClients()
    const a = hook({ createClient: first.createClient })
    act(() => void a.result.current.ask({ text: 'Eins', region: REGION }))
    await flush()
    a.unmount()

    const second = fakeClients()
    const b = hook({ createClient: second.createClient })
    act(() => void b.result.current.ask({ text: 'Zwei', region: REGION }))
    await flush()
    expect(second.made[0].options.conversationId).toBe('s_thread_doc_1')
    expect(second.made[0].options.conversationId).toBe(first.made[0].options.conversationId)
    expect(second.made[0].options.conversationExists).toBe(true)
    expect(resolveThread).toHaveBeenCalledWith('doc_1', 'Grundriss.pdf · Review')

    const other = fakeClients()
    const c = hook({ createClient: other.createClient, documentId: 'doc_2' })
    act(() => void c.result.current.ask({ text: 'Drei', region: REGION }))
    await flush()
    expect(other.made[0].options.conversationId).toBe('s_thread_doc_2')
  })

  it('asks the agent a reply under the turn id the server would give it', async () => {
    const { made, createClient } = fakeClients()
    const { result } = hook({ createClient })
    act(() => {
      result.current.ask({
        text: '@Agent stimmt das?',
        region: REGION,
        annotationId: 'ann_3',
        replyInThread: true,
        turnId: 'turn-of-the-reply',
      })
    })
    await flush()
    expect(made[0].asked[0].turnId).toBe('turn-of-the-reply')
    expect(result.current.asks[0].turnId).toBe('turn-of-the-reply')
  })

  it('names the Anmerkung a box belongs to, and drops a thread reply once its turn ended', async () => {
    const { made, createClient } = fakeClients()
    const { result } = hook({ createClient })
    let id = ''
    act(() => {
      id = result.current.ask({ text: '@Agent stimmt das?', region: REGION, annotationId: 'ann_3', replyInThread: true, baseline: 0 })
    })
    await flush()
    expect(made[0].asked[0].question).toMatchObject({ region: { ...REGION, annotation_id: 'ann_3' }, replyInThread: true })
    expect(result.current.openId).toBeNull()

    act(() => made[0].options.onTurn(finished(id, 'Ja.')))
    expect(result.current.asks).toEqual([])
  })

  it('over the chat, asks through the chat and reads the turn from its store', () => {
    const { made, createClient } = fakeClients()
    const questions: CanvasChatQuestion[] = []
    const withdraw = registerCanvasChatSender((question) => {
      questions.push(question)
      act(() => useChatStore.setState({ turns: { 'msg-9': initialTurnView('msg-9', 'chat_conv') } }))
      return { conversationId: 'chat_conv', turnId: 'msg-9' }
    })
    const { result } = hook({ createClient, chatHosted: true })

    act(() => void result.current.ask({ text: 'Maße prüfen', region: REGION, effort: 'low' }))

    expect(made).toEqual([])
    expect(questions).toEqual([
      {
        text: 'Maße prüfen',
        effort: 'low',
        focus: {
          documentId: 'doc_1',
          fileName: 'Grundriss.pdf',
          versionId: null,
          versionState: null,
          shelf: 'project',
          region: REGION,
          replyInThread: false,
        },
      },
    ])
    expect(result.current.asks[0]).toMatchObject({ backend: 'chat', turnId: 'msg-9', status: 'thinking' })
    expect(result.current.conversationHref).toBe('/app/projects/proj_1/chat?session=chat_conv')

    act(() => useChatStore.setState({ turns: { 'msg-9': { ...finished('msg-9', 'Fehlt.'), conversationId: 'chat_conv' } } }))
    expect(result.current.asks[0]).toMatchObject({ status: 'answered', view: { text: 'Fehlt.' } })
    withdraw()
    act(() => useChatStore.setState({ turns: {} }))
  })

  it('stands alone when no chat is there to carry the question', async () => {
    const { made, createClient } = fakeClients()
    const { result } = hook({ createClient, chatHosted: true })
    act(() => void result.current.ask({ text: 'Was ist das?', region: REGION }))
    await flush()
    expect(made).toHaveLength(1)
    expect(result.current.asks[0].backend).toBe('canvas')
  })

  it('offers nothing without a project to ask in', () => {
    const { createClient } = fakeClients()
    const { result } = hook({ createClient, projectId: null })
    expect(result.current.available).toBe(false)
  })
})

describe('askRegionOf', () => {
  it('keeps a region, and makes a point a small box around it on its page', () => {
    expect(askRegionOf({ page: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.4 })).toEqual({ page: 3, x: 0.1, y: 0.2, w: 0.3, h: 0.4 })
    expect(askRegionOf({ page: 1, x: 0.5, y: 0.5, w: null, h: null })).toEqual({ page: 1, x: 0.46, y: 0.46, w: 0.08, h: 0.08 })
    expect(askRegionOf({ page: 1, x: 0.99, y: 0.01 })).toEqual({ page: 1, x: 0.92, y: 0, w: 0.08, h: 0.08 })
  })
})

describe('while the agent works', () => {
  const BOX = { page: 2, x: 0.4, y: 0.2, w: 0.2, h: 0.2 }

  it('makes a box asked about meanwhile a note for the running turn, not a second question', async () => {
    const { made, createClient } = fakeClients()
    const { result } = hook({ createClient })
    let running = ''
    act(() => void (running = result.current.ask({ text: 'Markier die Tür.', region: REGION })))
    await flush()

    let composing = ''
    act(() => void (composing = result.current.compose(BOX)))
    act(() => void result.current.ask({ id: composing, text: 'nicht die Tür, die Treppe', region: BOX }))

    expect(made[0].asked).toHaveLength(1)
    expect(made[0].steered).toEqual([expect.objectContaining({ text: 'nicht die Tür, die Treppe', region: BOX })])
    expect(result.current.asks.map((ask) => ask.id)).toEqual([running])
    expect(result.current.openId).toBe(running)
  })

  it('asks a note the turn never read next, about the same box', async () => {
    const { made, createClient } = fakeClients()
    const { result } = hook({ createClient })
    act(() => void result.current.ask({ text: 'Markier die Tür.', region: REGION }))
    await flush()
    act(() => void result.current.steer('und das Podest?', BOX))

    const [{ onLeftover }] = made[0].steered
    act(() => {
      made[0].options.onTurn(finished(made[0].asked[0].turnId, 'Tür markiert.'))
      onLeftover?.('und das Podest?')
    })
    await flush()

    expect(made[0].asked.at(-1)).toMatchObject({ question: { text: 'und das Podest?', region: BOX } })
  })

  it('over the chat, steers the chat’s running turn through its driver', () => {
    const { made, createClient } = fakeClients()
    const notes: CanvasChatSteer[] = []
    const withdraw = registerCanvasChatSteerer((note) => {
      notes.push(note)
      return true
    })
    act(() =>
      useChatStore.setState({
        currentConversation: { id: 'chat_conv', userId: 'u', title: '', messages: [], createdAt: new Date(), updatedAt: new Date() },
        turns: { 'msg-9': { ...initialTurnView('msg-9', 'chat_conv') } },
      })
    )
    const { result } = hook({ createClient, chatHosted: true })

    let taken = false
    act(() => void (taken = result.current.steer('die Treppe', BOX)))

    expect(taken).toBe(true)
    expect(notes).toEqual([expect.objectContaining({ text: 'die Treppe', focusRegion: BOX })])
    expect(made).toEqual([])
    withdraw()
    act(() => useChatStore.setState({ turns: {}, currentConversation: null }))
  })
})

describe('how a turn that ended stands (statusOf)', () => {
  const ended = (patch: Partial<TurnView>): TurnView => ({ ...initialTurnView('t', 'conv'), phase: 'finished', ...patch })
  const result = (patch: Record<string, unknown>) => ({ message_id: 'm', text: 'x', ...patch }) as TurnView['result']

  it('reads the outcome, not the phase: a refusal and a full queue are not answers to keep', () => {
    expect(statusOf(ended({ outcome: 'answered' }))).toBe('answered')
    expect(statusOf(ended({ outcome: 'refused' }))).toBe('declined')
    expect(statusOf(ended({ outcome: 'answered', result: result({ job_admission_rejected: true }) }))).toBe('declined')
    expect(statusOf(ended({ outcome: 'handed_off' }))).toBe('handedOff')
    expect(statusOf(ended({ outcome: 'answered', result: result({ run: { run_id: 'r', run_message_id: 'rm' } }) }))).toBe(
      'handedOff'
    )
    expect(statusOf(ended({ outcome: 'cancelled' }))).toBe('stopped')
    expect(statusOf({ ...initialTurnView('t', 'conv') })).toBe('thinking')
    expect(statusOf(ended({ phase: 'failed' }))).toBe('failed')
  })
})

describe('a question that went without part of itself', () => {
  it('keeps a thread answer whose thread target never reached the server, and marks the box it lost', async () => {
    const { made, createClient } = fakeClients()
    const { result } = hook({ createClient })
    let id = ''
    act(() => {
      id = result.current.ask({ text: '@Agent stimmt das?', region: REGION, annotationId: 'ann_3', replyInThread: true, baseline: 0 })
    })
    await flush()
    act(() => made[0].options.onDegraded?.(id, ['region', 'thread']))
    expect(result.current.asks[0].degraded).toEqual(['region', 'thread'])

    act(() => made[0].options.onTurn(finished(id, 'Ja.')))
    expect(result.current.asks).toEqual([expect.objectContaining({ id, status: 'answered' })])
  })
})
