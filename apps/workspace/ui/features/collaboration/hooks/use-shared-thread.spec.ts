import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { CollaborationEvent } from '@/lib/events/types'

const mockDeepResearchApi = vi.hoisted(() => ({
  getJobStatus: vi.fn().mockResolvedValue(undefined),
  cancelJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock('@/adapters/api/deep-research-client', () => ({
  getJobStatus: mockDeepResearchApi.getJobStatus,
  cancelJob: mockDeepResearchApi.cancelJob,
}))

const hub = vi.hoisted(() => ({
  listeners: new Set<(event: CollaborationEvent) => void>(),
  subscribeToEvents: vi.fn(),
  subscribeToConnection: vi.fn(),
}))
vi.mock('../lib/event-hub', () => ({
  subscribeToEvents: (listener: (event: CollaborationEvent) => void) => {
    hub.subscribeToEvents(listener)
    hub.listeners.add(listener)
    return () => hub.listeners.delete(listener)
  },
  subscribeToConnection: (listener: (connected: boolean) => void) => {
    hub.subscribeToConnection(listener)
    listener(true)
    return () => {}
  },
}))

import { useChatStore } from '@/features/chat/store'
import {
  bumpThreadRevision,
  getThreadSharing,
  resetThreadSharing,
} from '@/shared/collaboration/thread-sharing'
import {
  markConversationMinted,
  markConversationOnServer,
  resetConversationsOnServer,
} from '@/features/chat/lib/conversation-on-server'
import { useSharedThread } from './use-shared-thread'

const CONVERSATION_ID = 's_conv_shared'
const ME = 'user_me'
const ANNA = 'user_anna'

const at = (minute: number): string => `2026-07-29T09:0${minute}:00.000Z`

const row = (
  id: string,
  overrides: Partial<{
    role: string
    authorUserId: string | null
    content: string
    createdAt: string
    metadata: Record<string, unknown>
  }> = {}
) => ({
  id,
  conversationId: CONVERSATION_ID,
  role: 'user',
  authorUserId: ME,
  content: `message ${id}`,
  metadata: { messageType: 'user' },
  createdAt: at(1),
  ...overrides,
})

const ROSTER = {
  resourceType: 'conversation',
  resourceId: CONVERSATION_ID,
  visibility: 'project',
  allowedVisibilities: ['private', 'project'],
  myRole: 'collaborator',
  canManage: false,
  canEscalate: false,
  shared: true,
  entries: [
    {
      person: { userId: ME, name: 'Me Myself', email: null, profilePictureUrl: null },
      role: 'owner',
      reason: 'creator',
      grantedBy: null,
    },
    {
      person: { userId: ANNA, name: 'Anna Berger', email: null, profilePictureUrl: 'https://x/a.png' },
      role: 'collaborator',
      reason: 'grant',
      grantedBy: ME,
    },
  ],
}

interface RouteState {
  shared: boolean
  lastReadMessageId: string | null
  messages: ReturnType<typeof row>[]
}

let routes: RouteState
let fetchMock: ReturnType<typeof vi.fn>

const requested = (): string[] =>
  fetchMock.mock.calls.map((call) => String(call[0]))

const seedStore = (messages: Array<{ id: string; content: string; timestamp: Date }> = []) => {
  const conversation = {
    id: CONVERSATION_ID,
    userId: ME,
    projectId: 'p1',
    title: 'Brandschutz',
    messages: messages.map((message) => ({
      id: message.id,
      role: 'user' as const,
      content: message.content,
      timestamp: message.timestamp,
      messageType: 'user' as const,
    })),
    createdAt: new Date(at(0)),
    updatedAt: new Date(at(0)),
  }
  useChatStore.setState({
    currentUserId: ME,
    conversations: [conversation],
    currentConversation: conversation,
  })
}

const storedMessages = () =>
  useChatStore.getState().conversations.find((c) => c.id === CONVERSATION_ID)?.messages ?? []

const emit = async (event: CollaborationEvent) => {
  await act(async () => {
    for (const listener of hub.listeners) listener(event)
  })
}

beforeEach(() => {
  hub.listeners.clear()
  hub.subscribeToEvents.mockClear()
  hub.subscribeToConnection.mockClear()

  routes = { shared: true, lastReadMessageId: null, messages: [row('m1')] }

  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    if (url === `/api/conversations/${CONVERSATION_ID}`) {
      return Response.json({
        id: CONVERSATION_ID,
        title: 'Brandschutz',
        shared: routes.shared,
        myRole: 'collaborator',
        visibility: routes.shared ? 'project' : 'private',
        myReadState: routes.lastReadMessageId
          ? { lastReadAt: at(1), lastReadMessageId: routes.lastReadMessageId }
          : null,
      })
    }
    if (url.startsWith(`/api/conversations/${CONVERSATION_ID}/messages`)) {
      return Response.json({ messages: routes.messages, nextCursor: null })
    }
    if (url === `/api/sharing/conversation/${CONVERSATION_ID}`) {
      return Response.json(ROSTER)
    }
    if (url === `/api/conversations/${CONVERSATION_ID}/read`) {
      return Response.json({ ok: true })
    }
    throw new Error(`unexpected request: ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  seedStore()
})

afterEach(() => {
  vi.unstubAllGlobals()
  useChatStore.setState({ conversations: [], currentConversation: null, currentUserId: null })
})

describe('useSharedThread — the private path is untouched (spec NF-8)', () => {
  test('does nothing at all when collaboration is disabled: no fetch, no subscription', async () => {
    seedStore([{ id: 'local-1', content: 'my private note', timestamp: new Date(at(1)) }])

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: false, currentUserId: ME })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(hub.subscribeToEvents).not.toHaveBeenCalled()
    expect(result.current.shared).toBe(false)
    expect(result.current.turnInFlight).toBeNull()
    expect(storedMessages().map((m) => m.id)).toEqual(['local-1'])
  })

  test('a conversation the server reports as private loads no history and opens no channel', async () => {
    routes.shared = false
    seedStore([{ id: 'local-1', content: 'my private note', timestamp: new Date(at(1)) }])

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await act(async () => {
      await Promise.resolve()
    })

    expect(requested()).toEqual([`/api/conversations/${CONVERSATION_ID}`])
    expect(hub.subscribeToEvents).not.toHaveBeenCalled()
    expect(result.current.shared).toBe(false)
    expect(storedMessages().map((m) => m.id)).toEqual(['local-1'])
  })

  test('subscribes only once the server has confirmed the thread is shared', async () => {
    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(result.current.shared).toBe(true))
    expect(hub.subscribeToEvents).toHaveBeenCalled()
  })
})

describe('useSharedThread — the server is authoritative', () => {
  test('replaces the local copy with the server history on open', async () => {
    seedStore([{ id: 'stale', content: 'written before sharing', timestamp: new Date(at(1)) }])
    routes.messages = [
      row('m1', { createdAt: at(2), content: 'my question' }),
      row('m2', { role: 'assistant', authorUserId: null, createdAt: at(3), content: 'the answer' }),
      row('m3', { authorUserId: ANNA, createdAt: at(4), content: "Anna's addition" }),
    ]

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(storedMessages()).toHaveLength(3))
    expect(storedMessages().map((m) => m.id)).toEqual(['m1', 'm2', 'm3'])
    expect(result.current.shared).toBe(true)
  })

  test('orders by server timestamp with the message id as the tiebreak (spec CC-11)', async () => {
    routes.messages = [
      row('b', { createdAt: at(3) }),
      row('a', { createdAt: at(3) }),
      row('c', { createdAt: at(2) }),
    ]

    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(storedMessages()).toHaveLength(3))
    expect(storedMessages().map((m) => m.id)).toEqual(['c', 'a', 'b'])
  })

  test('resolves author names and avatars from the conversation roster', async () => {
    routes.messages = [row('m1', { authorUserId: ANNA, createdAt: at(2) })]

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(storedMessages()).toHaveLength(1))
    await waitFor(() => expect(storedMessages()[0].authorName).toBe('Anna Berger'))
    expect(storedMessages()[0].authorUserId).toBe(ANNA)
    expect(storedMessages()[0].authorAvatarUrl).toBe('https://x/a.png')
    expect(result.current.authorOf(ANNA)?.name).toBe('Anna Berger')
  })

  test('keeps the in-flight streaming bubble the server has not been told about', async () => {
    useChatStore.setState({
      conversations: [
        {
          id: CONVERSATION_ID,
          userId: ME,
          projectId: 'p1',
          title: 'Brandschutz',
          messages: [
            {
              id: 'live-answer',
              role: 'assistant',
              content: 'partial…',
              timestamp: new Date(at(1)),
              messageType: 'agent_response',
              isStreaming: true,
            },
          ],
          createdAt: new Date(at(0)),
          updatedAt: new Date(at(0)),
        },
      ],
      currentConversation: null,
      currentUserId: ME,
    })
    routes.messages = [row('m1', { createdAt: at(4) })]

    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(storedMessages().some((m) => m.id === 'm1')).toBe(true))
    expect(storedMessages().map((m) => m.id)).toContain('live-answer')
  })
})

describe('useSharedThread — reconciliation', () => {
  test("a colleague's message arrives on the event, deduplicated against our own echo", async () => {
    routes.messages = [row('m1', { createdAt: at(2) })]

    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(storedMessages()).toHaveLength(1))

    routes.messages = [...routes.messages, row('m2', { authorUserId: ANNA, createdAt: at(3) })]
    await emit({
      kind: 'conversation.message',
      conversationId: CONVERSATION_ID,
      authorUserId: ANNA,
      messageId: 'm2',
    })

    await waitFor(() => expect(storedMessages()).toHaveLength(2))
    await emit({
      kind: 'conversation.message',
      conversationId: CONVERSATION_ID,
      authorUserId: ANNA,
      messageId: 'm2',
    })
    await waitFor(() => expect(storedMessages()).toHaveLength(2))
    expect(storedMessages().filter((m) => m.id === 'm2')).toHaveLength(1)
  })

  test('re-reads for our own write too — the second device has no echo', async () => {
    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(storedMessages()).toHaveLength(1))
    const before = requested().length

    routes.messages = [...routes.messages, row('mine', { authorUserId: ME, createdAt: at(3) })]
    await emit({
      kind: 'conversation.message',
      conversationId: CONVERSATION_ID,
      authorUserId: ME,
      messageId: 'mine',
    })

    expect(requested().slice(before).some((url) => url.startsWith(`/api/conversations/${CONVERSATION_ID}/messages`))).toBe(true)
    await waitFor(() => expect(storedMessages()).toHaveLength(2))
    expect(storedMessages().filter((m) => m.id === 'mine')).toHaveLength(1)
  })

  test('ignores events for a different conversation', async () => {
    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(storedMessages()).toHaveLength(1))
    const before = requested().length

    await emit({
      kind: 'conversation.message',
      conversationId: 's_other',
      authorUserId: ANNA,
      messageId: 'x',
    })

    expect(requested()).toHaveLength(before)
  })

  test('converges on window focus alone, with no event at all (spec CC-10, RT-4)', async () => {
    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(storedMessages()).toHaveLength(1))

    routes.messages = [...routes.messages, row('m9', { authorUserId: ANNA, createdAt: at(5) })]

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(storedMessages().map((m) => m.id)).toContain('m9'))
  })

  test('a thread that is not shared yet still converges on focus', async () => {
    routes.shared = false
    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.shared).toBe(false)
    expect(hub.subscribeToEvents).not.toHaveBeenCalled()

    routes.shared = true

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(result.current.shared).toBe(true))
    expect(getThreadSharing(CONVERSATION_ID)).toBe('shared')
  })

  test('does not re-read access on every alt-tab of a private thread', async () => {
    routes.shared = false
    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = requested().length

    await act(async () => {
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
      window.dispatchEvent(new Event('focus'))
    })

    await waitFor(() => expect(requested().length).toBe(before + 1))
  })

  test('announces an arrival, but is silent about the history it opened with', async () => {
    routes.messages = [row('m1', { authorUserId: ANNA, createdAt: at(2) })]

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(storedMessages()).toHaveLength(1))
    expect(result.current.lastArrival).toBeNull()

    routes.messages = [...routes.messages, row('m2', { authorUserId: ANNA, createdAt: at(3) })]
    await emit({
      kind: 'conversation.message',
      conversationId: CONVERSATION_ID,
      authorUserId: ANNA,
      messageId: 'm2',
    })

    await waitFor(() => expect(result.current.lastArrival?.messageId).toBe('m2'))
    expect(result.current.lastArrival?.authorName).toBe('Anna Berger')
  })

  test('exposes who the agent is working for, and clears it when the turn ends', async () => {
    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(result.current.shared).toBe(true))

    await emit({
      kind: 'conversation.turn',
      conversationId: CONVERSATION_ID,
      phase: 'started',
      actorUserId: ANNA,
    })
    expect(result.current.turnInFlight).toEqual({ actorUserId: ANNA })

    await emit({
      kind: 'conversation.turn',
      conversationId: CONVERSATION_ID,
      phase: 'ended',
      actorUserId: ANNA,
    })
    await waitFor(() => expect(result.current.turnInFlight).toBeNull())
  })

  test('the end of a turn waits for the read that brings its answer, so the observer is never left blank', async () => {
    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(result.current.shared).toBe(true))
    await emit({ kind: 'conversation.turn', conversationId: CONVERSATION_ID, phase: 'started', actorUserId: ANNA })

    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    const answered = [
      ...routes.messages,
      row('a1', { role: 'assistant', authorUserId: null, metadata: { messageType: 'agent_response' } }),
    ]
    fetchMock.mockImplementationOnce(async () => {
      await held
      return Response.json({ messages: answered, nextCursor: null })
    })
    await emit({ kind: 'conversation.turn', conversationId: CONVERSATION_ID, phase: 'ended', actorUserId: ANNA })

    expect(result.current.turnInFlight).not.toBeNull()

    await act(async () => release())
    await waitFor(() => expect(result.current.turnInFlight).toBeNull())
    expect(storedMessages().some((message) => message.id === 'a1')).toBe(true)
  })

  test('picks up the server-authoritative path when a thread that was private is re-opened', async () => {
    routes.shared = false
    const first = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(first.result.current.shared).toBe(false)
    expect(hub.subscribeToEvents).not.toHaveBeenCalled()
    first.unmount()

    routes.shared = true
    const second = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(second.result.current.shared).toBe(true))
    await waitFor(() => expect(storedMessages()).toHaveLength(1))
    expect(hub.subscribeToEvents).toHaveBeenCalled()
  })

  test('a shared thread that becomes shared-then-changed re-reads the access fact on the event', async () => {
    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(result.current.shared).toBe(true))
    const before = requested().length

    await emit({
      kind: 'resource.access.changed',
      resourceType: 'conversation',
      resourceId: CONVERSATION_ID,
      change: 'visibility',
    })

    await waitFor(() =>
      expect(requested().slice(before)).toContain(`/api/conversations/${CONVERSATION_ID}`)
    )
  })

  test('a network failure on the access read is retried, not treated as "not shared"', async () => {
    vi.useFakeTimers()
    try {
      let accessReads = 0
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === `/api/conversations/${CONVERSATION_ID}`) {
          accessReads += 1
          if (accessReads === 1) throw new TypeError('network error')
          return Response.json({
            id: CONVERSATION_ID,
            title: 'Brandschutz',
            shared: true,
            myRole: 'collaborator',
            visibility: 'project',
            myReadState: null,
          })
        }
        if (url.startsWith(`/api/conversations/${CONVERSATION_ID}/messages`))
          return Response.json({ messages: [], nextCursor: null })
        if (url === `/api/sharing/conversation/${CONVERSATION_ID}`) return Response.json(ROSTER)
        throw new Error(`unexpected request: ${url}`)
      })

      const { result } = renderHook(() =>
        useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(0)
      })
      expect(result.current.accessLost).toBe(false)
      expect(accessReads).toBe(1)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100)
      })
      expect(accessReads).toBeGreaterThan(1)
      await vi.waitFor(() => expect(result.current.shared).toBe(true))
    } finally {
      vi.useRealTimers()
    }
  })

  test('re-reads the access facts when the thread is declared stale', async () => {
    let shared = false
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/api/conversations/${CONVERSATION_ID}`) {
        return Response.json({
          id: CONVERSATION_ID,
          title: 'Brandschutz',
          shared,
          myRole: shared ? 'owner' : null,
          visibility: shared ? 'project' : 'private',
          myReadState: null,
        })
      }
      if (url.startsWith(`/api/conversations/${CONVERSATION_ID}/messages`)) return Response.json({ messages: [], nextCursor: null })
      if (url === `/api/sharing/conversation/${CONVERSATION_ID}`) return Response.json(ROSTER)
      throw new Error(`unexpected request: ${url}`)
    })

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.shared).toBe(false)

    shared = true
    await act(async () => {
      bumpThreadRevision(CONVERSATION_ID)
    })

    await waitFor(() => expect(result.current.shared).toBe(true))
  })

  test('a turn that keeps showing signs of life is never expired', async () => {
    vi.useFakeTimers()
    try {
      const { result } = renderHook(() =>
        useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
      )
      await vi.waitFor(() => expect(result.current.shared).toBe(true))

      await act(async () => {
        emit({
          kind: 'conversation.turn',
          conversationId: CONVERSATION_ID,
          phase: 'started',
          actorUserId: ANNA,
        })
      })
      expect(result.current.turnInFlight).not.toBeNull()

      for (let minute = 0; minute < 20; minute += 1) {
        act(() => result.current.noteTurnActivity())
        await act(async () => {
          await vi.advanceTimersByTimeAsync(60_000)
        })
        act(() => result.current.refresh())
      }
      expect(result.current.turnInFlight).not.toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(6 * 60_000)
      })
      expect(result.current.turnInFlight).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  test('a 502 is a blip, not a revocation', async () => {
    vi.useFakeTimers()
    try {
      let accessReads = 0
      fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url === `/api/conversations/${CONVERSATION_ID}`) {
          accessReads += 1
          if (accessReads === 2) return new Response(null, { status: 502 })
          return Response.json({
            id: CONVERSATION_ID,
            title: 'Brandschutz',
            shared: true,
            myRole: 'collaborator',
            visibility: 'project',
            myReadState: null,
          })
        }
        if (url.startsWith(`/api/conversations/${CONVERSATION_ID}/messages`)) return Response.json({ messages: [], nextCursor: null })
        if (url === `/api/sharing/conversation/${CONVERSATION_ID}`) return Response.json(ROSTER)
        throw new Error(`unexpected request: ${url}`)
      })

      const { result } = renderHook(() =>
        useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
      )
      await vi.waitFor(() => expect(result.current.shared).toBe(true))

      await act(async () => {
        await emit({
          kind: 'resource.access.changed',
          resourceType: 'conversation',
          resourceId: CONVERSATION_ID,
          change: 'visibility',
        })
      })

      expect(result.current.shared).toBe(true)
      expect(result.current.accessLost).toBe(false)

      const before = accessReads
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100)
      })
      expect(accessReads).toBeGreaterThan(before)
    } finally {
      vi.useRealTimers()
    }
  })

  test('access revoked between the access read and the history read is still flagged', async () => {
    let accessReads = 0
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url === `/api/conversations/${CONVERSATION_ID}`) {
        accessReads += 1
        if (accessReads === 1) {
          return Response.json({
            id: CONVERSATION_ID,
            title: 'Brandschutz',
            shared: true,
            myRole: 'collaborator',
            visibility: 'project',
            myReadState: null,
          })
        }
        return new Response(null, { status: 403 })
      }
      if (url.startsWith(`/api/conversations/${CONVERSATION_ID}/messages`)) {
        return new Response(null, { status: 403 })
      }
      if (url === `/api/sharing/conversation/${CONVERSATION_ID}`) return Response.json(ROSTER)
      throw new Error(`unexpected request: ${url}`)
    })

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(result.current.accessLost).toBe(true))
    expect(result.current.shared).toBe(false)
    expect(accessReads).toBe(2)
  })
})

describe('useSharedThread — read state', () => {
  test('exposes the unread anchor the reader arrived with (spec CC-19)', async () => {
    routes.lastReadMessageId = 'm1'
    routes.messages = [row('m1', { createdAt: at(2) }), row('m2', { authorUserId: ANNA, createdAt: at(3) })]

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(result.current.unreadAfterMessageId).toBe('m1'))
  })

  test('marks the thread read once, debounced, with the newest message id', async () => {
    vi.useFakeTimers()
    try {
      routes.messages = [row('m1', { createdAt: at(2) }), row('m2', { authorUserId: ANNA, createdAt: at(3) })]

      renderHook(() =>
        useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
      expect(requested()).not.toContain(`/api/conversations/${CONVERSATION_ID}/read`)

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })

      const reads = fetchMock.mock.calls.filter(
        (call) => String(call[0]) === `/api/conversations/${CONVERSATION_ID}/read`
      )
      expect(reads).toHaveLength(1)
      expect(JSON.parse(String((reads[0][1] as RequestInit).body))).toEqual({
        lastReadMessageId: 'm2',
      })
    } finally {
      vi.useRealTimers()
    }
  })

  test('does not mark read while the thread is not on screen', async () => {
    vi.useFakeTimers()
    try {
      renderHook(() =>
        useSharedThread({
          conversationId: CONVERSATION_ID,
          enabled: true,
          currentUserId: ME,
          active: false,
        })
      )

      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_000)
      })

      expect(requested()).not.toContain(`/api/conversations/${CONVERSATION_ID}/read`)
    } finally {
      vi.useRealTimers()
    }
  })

  const holdReadReceipts = () => {
    routes.messages = [row('m1', { createdAt: at(2) }), row('m2', { authorUserId: ANNA, createdAt: at(3) })]
    const held: Array<(error: Error) => void> = []
    const answer = fetchMock.getMockImplementation() as (input: RequestInfo | URL) => Promise<Response>
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) !== `/api/conversations/${CONVERSATION_ID}/read`) return answer(input)
      return new Promise<Response>((_resolve, reject) => held.push(reject))
    })
    const posted = () =>
      fetchMock.mock.calls.filter((call) => String(call[0]) === `/api/conversations/${CONVERSATION_ID}/read`).length
    const openAndRead = async () => {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50)
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
    }
    return { held, posted, openAndRead }
  }

  test('tries a failed read receipt again while the thread is still open', async () => {
    vi.useFakeTimers()
    try {
      const { held, posted, openAndRead } = holdReadReceipts()
      renderHook(() => useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME }))
      await openAndRead()
      expect(posted()).toBe(1)

      await act(async () => {
        held[0](new Error('offline'))
        await vi.advanceTimersByTimeAsync(9_000)
      })

      expect(posted()).toBe(2)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a read receipt that fails after the reader left the thread is not tried again', async () => {
    vi.useFakeTimers()
    try {
      const { held, posted, openAndRead } = holdReadReceipts()
      const { unmount } = renderHook(() =>
        useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
      )
      await openAndRead()
      expect(posted()).toBe(1)

      unmount()
      await act(async () => {
        held[0](new Error('offline'))
        await vi.advanceTimersByTimeAsync(30_000)
      })

      expect(posted()).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useSharedThread — sharedness is published for the agent-socket gate', () => {
  beforeEach(() => {
    resetThreadSharing()
  })

  test('a shared thread is published as shared', async () => {
    routes.shared = true

    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(getThreadSharing(CONVERSATION_ID)).toBe('shared'))
  })

  test('a private thread is published as private, so its socket still opens on mount', async () => {
    routes.shared = false

    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(getThreadSharing(CONVERSATION_ID)).toBe('private'))
  })

  test('collaboration disabled publishes nothing — the gate must not need this hook at all', async () => {
    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: false, currentUserId: ME })
    )

    await act(async () => {
      await Promise.resolve()
    })

    expect(getThreadSharing(CONVERSATION_ID)).toBe('unknown')
  })

  test('a failed access read publishes nothing rather than guessing "private"', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('offline')
    })

    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getThreadSharing(CONVERSATION_ID)).toBe('unknown')
  })
})

describe('useSharedThread — a chat this page minted', () => {
  beforeEach(() => {
    resetThreadSharing()
    resetConversationsOnServer()
  })
  afterEach(() => {
    resetConversationsOnServer()
  })

  test('is not asked about before the server has created it, and is private meanwhile', async () => {
    markConversationMinted(CONVERSATION_ID)

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.shared).toBe(false)
    expect(getThreadSharing(CONVERSATION_ID)).toBe('private')
  })

  test('is read once the create has landed, without replacing what is on screen', async () => {
    routes.shared = false
    markConversationMinted(CONVERSATION_ID)
    renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => markConversationOnServer(CONVERSATION_ID))

    await waitFor(() => expect(requested()).toEqual([`/api/conversations/${CONVERSATION_ID}`]))
  })

  test('a conversation this page did not mint (a link, the list) is read at once', async () => {
    markConversationMinted('s_some_other_new_chat')

    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )

    await waitFor(() => expect(result.current.shared).toBe(true))
    expect(requested()[0]).toBe(`/api/conversations/${CONVERSATION_ID}`)
  })
})

describe('useSharedThread — composing presence', () => {
  const mountShared = async () => {
    const hook = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(hook.result.current.shared).toBe(true))
    await waitFor(() => expect(hook.result.current.participants.length).toBeGreaterThan(0))
    return hook
  }

  const typing = (userId: string, isTyping: boolean, ttlMs = 6_000): CollaborationEvent => ({
    kind: 'conversation.typing',
    conversationId: CONVERSATION_ID,
    userId,
    typing: isTyping,
    ttlMs,
  })

  test('names a colleague who is composing, resolved from the roster', async () => {
    const { result } = await mountShared()

    await emit(typing(ANNA, true))

    await waitFor(() => expect(result.current.typists).toHaveLength(1))
    expect(result.current.typists[0].userId).toBe(ANNA)
    expect(result.current.typists[0].name).toBeTruthy()
  })

  test('a withdrawal clears the claim immediately', async () => {
    const { result } = await mountShared()

    await emit(typing(ANNA, true))
    await waitFor(() => expect(result.current.typists).toHaveLength(1))

    await emit(typing(ANNA, false))
    await waitFor(() => expect(result.current.typists).toHaveLength(0))
  })

  test('a claim whose withdrawal never arrives expires on its own', async () => {
    const { result } = await mountShared()

    await emit(typing(ANNA, true, 20))
    await waitFor(() => expect(result.current.typists).toHaveLength(1))

    await waitFor(() => expect(result.current.typists).toHaveLength(0), { timeout: 3_000 })
  })

  test('never reports the reader as typing', async () => {
    const { result } = await mountShared()

    await emit(typing(ME, true))

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.typists).toHaveLength(0)
  })

  test('ignores presence for a different conversation', async () => {
    const { result } = await mountShared()

    await emit({
      kind: 'conversation.typing',
      conversationId: 'some_other_conversation',
      userId: ANNA,
      typing: true,
      ttlMs: 6_000,
    })

    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.typists).toHaveLength(0)
  })

  test('presence costs a private thread no requests', async () => {
    routes.shared = false
    const { result } = renderHook(() =>
      useSharedThread({ conversationId: CONVERSATION_ID, enabled: true, currentUserId: ME })
    )
    await waitFor(() => expect(result.current.shared).toBe(false))

    await emit(typing(ANNA, true))

    expect(result.current.typists).toHaveLength(0)
    expect(requested()).not.toContain(`/api/sharing/conversation/${CONVERSATION_ID}`)
  })
})
