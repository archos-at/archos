/**
 * The reader's own personal notes under an answer (ADR-0180): read per person
 * and per conversation, never off the message, and read again only when the
 * answer's turn says they may have changed.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

const chat = vi.hoisted(() => ({
  state: { turns: {} as Record<string, unknown> },
  listeners: new Set<() => void>(),
}))
vi.mock('../store', async () => {
  const { useSyncExternalStore } = await import('react')
  const subscribe = (listener: () => void) => {
    chat.listeners.add(listener)
    return () => chat.listeners.delete(listener)
  }
  return {
    useChatStore: <T,>(selector: (state: typeof chat.state) => T): T =>
      useSyncExternalStore(subscribe, () => selector(chat.state)),
  }
})

import {
  loadPersonalNotes,
  loadProjectShelf,
  noteAddress,
  resetTurnNotes,
  usePersonalTurnNotes,
  useTurnNotes,
} from './turn-notes-store'
import type { TurnMemoryItem } from '../lib/turn-memory'

const CONVERSATION = 's-1'
const ANSWER = '4f9c1d2e-3b4a-5c5d-8e6f-7a8b9c0d1e2f'
const OTHER_ANSWER = '11111111-2222-5333-8444-555555555555'

const row = (id: string, sourceMessageId: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  kind: 'profile',
  content: `Note ${id}`,
  provenanceType: 'distillation',
  sourceConversationId: CONVERSATION,
  sourceMessageId,
  // What the route also sends and the chip has no use for.
  organizationId: 'org_1',
  userId: 'user_1',
  ...extra,
})

let served: unknown[] = []
const requests: string[] = []

const setTurns = (turns: Record<string, unknown>): void => {
  chat.state = { turns }
  act(() => chat.listeners.forEach((listener) => listener()))
}
const turn = (overrides: Record<string, unknown> = {}) => ({
  conversationId: CONVERSATION,
  messageId: ANSWER,
  stages: {},
  ...overrides,
})

beforeEach(() => {
  served = []
  requests.length = 0
  chat.state = { turns: {} }
  resetTurnNotes()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      requests.push(String(input))
      return Response.json({ items: served, nextCursor: null })
    })
  )
})
afterEach(() => vi.unstubAllGlobals())

describe('usePersonalTurnNotes', () => {
  test('asks for the reader’s notes of the conversation and keeps the ones saved under this answer', async () => {
    served = [row('a', ANSWER), row('b', OTHER_ANSWER), row('c', null)]
    const { result } = renderHook(() => usePersonalTurnNotes(CONVERSATION, ANSWER))

    await waitFor(() => expect(result.current).toHaveLength(1))
    expect(result.current[0]).toMatchObject({ id: 'a', kind: 'profile', content: 'Note a', provenanceType: 'distillation' })
    expect(requests).toEqual([`/api/user/memory?sourceConversationId=${CONVERSATION}&limit=200`])
  })

  test('every answer of a thread shares one read', async () => {
    served = [row('a', ANSWER), row('b', OTHER_ANSWER)]
    const first = renderHook(() => usePersonalTurnNotes(CONVERSATION, ANSWER))
    const second = renderHook(() => usePersonalTurnNotes(CONVERSATION, OTHER_ANSWER))

    await waitFor(() => expect(second.result.current).toHaveLength(1))
    expect(first.result.current.map((note) => note.id)).toEqual(['a'])
    expect(second.result.current.map((note) => note.id)).toEqual(['b'])
    expect(requests).toHaveLength(1)
  })

  test('a reader who holds no note of the conversation is shown none (a colleague in a shared chat)', async () => {
    served = []
    const { result } = renderHook(() => usePersonalTurnNotes(CONVERSATION, ANSWER))

    await waitFor(() => expect(useTurnNotes.getState().personal[CONVERSATION]).toEqual([]))
    expect(result.current).toEqual([])
  })

  test('asks nothing without a conversation or an answer id', () => {
    renderHook(() => usePersonalTurnNotes(null, ANSWER))
    renderHook(() => usePersonalTurnNotes(CONVERSATION, undefined))
    expect(requests).toEqual([])
  })

  test('reads again when the answer’s turn delivers its result, and when its reflection stage reports', async () => {
    const { result } = renderHook(() => usePersonalTurnNotes(CONVERSATION, ANSWER))
    await waitFor(() => expect(requests).toHaveLength(1))

    // Still writing: nothing has changed that a note could have come from.
    setTurns({ t1: turn() })
    expect(requests).toHaveLength(1)

    // The result: the `remember` tool may have kept a note during the answer.
    served = [row('in-turn', ANSWER, { provenanceType: 'agent' })]
    setTurns({ t1: turn({ result: { message_id: ANSWER } }) })
    await waitFor(() => expect(result.current.map((note) => note.id)).toEqual(['in-turn']))
    expect(requests).toHaveLength(2)

    // The stage reports `empty`: a pass that kept only a personal note puts nothing on the frame.
    served = [row('in-turn', ANSWER, { provenanceType: 'agent' }), row('after', ANSWER)]
    setTurns({ t1: turn({ result: { message_id: ANSWER }, stages: { memory_reflection: { status: 'empty' } } }) })
    await waitFor(() => expect(result.current.map((note) => note.id)).toEqual(['in-turn', 'after']))
    expect(requests).toHaveLength(3)
  })

  test('another answer’s turn moving is no reason to read again', async () => {
    renderHook(() => usePersonalTurnNotes(CONVERSATION, OTHER_ANSWER))
    await waitFor(() => expect(requests).toHaveLength(1))

    setTurns({ t1: turn({ result: { message_id: ANSWER } }) })
    expect(requests).toHaveLength(1)
  })

  test('a failed read leaves what was known and shows no row it cannot vouch for', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })))
    const { result } = renderHook(() => usePersonalTurnNotes(CONVERSATION, ANSWER))

    await act(() => loadPersonalNotes(CONVERSATION))
    expect(result.current).toEqual([])
    expect(useTurnNotes.getState().personal[CONVERSATION]).toBeUndefined()
  })
})

describe('loadProjectShelf', () => {
  test('keeps whether the reader may write and which of the conversation’s notes are still active', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ id: 'n-1' }], nextCursor: null, canWrite: true })))
    await loadProjectShelf('p 1', CONVERSATION)
    expect(useTurnNotes.getState().shelves[`p 1:${CONVERSATION}`]).toEqual({ canWrite: true, activeIds: ['n-1'] })
  })

  test('claims no absence when the list did not fit one page, and no right the route did not state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ items: [{ id: 'n-1' }], nextCursor: '200' })))
    await loadProjectShelf('p-1', CONVERSATION)
    expect(useTurnNotes.getState().shelves[`p-1:${CONVERSATION}`]).toEqual({ canWrite: false, activeIds: null })
  })

  test('a project the reader may not read answers nothing, so nothing is offered', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })))
    await loadProjectShelf('p-1', CONVERSATION)
    expect(useTurnNotes.getState().shelves).toEqual({})
  })
})

describe('noteAddress', () => {
  const note = (audience: TurnMemoryItem['audience'], noteId: string | undefined = 'n 1'): TurnMemoryItem => ({
    id: 'row',
    kind: 'decision',
    content: 'x',
    provenance: 'inTurn',
    audience,
    noteId,
  })

  test('is the item route of the shelf the note is on', () => {
    expect(noteAddress(note('personal'), 'p-1')).toBe('/api/user/memory/n%201')
    expect(noteAddress(note('organization'), null)).toBe('/api/organization/memory/n%201')
    expect(noteAddress(note('project'), 'p-1')).toBe('/api/projects/p-1/memory/n%201')
    expect(noteAddress(note('restricted'), 'p-1')).toBe('/api/projects/p-1/memory/n%201')
  })

  test('is nothing for a note the turn cannot name, on no known shelf, or in no project', () => {
    expect(noteAddress({ ...note('project'), noteId: undefined }, 'p-1')).toBeNull()
    expect(noteAddress(note(undefined), 'p-1')).toBeNull()
    expect(noteAddress(note('project'), null)).toBeNull()
  })
})
