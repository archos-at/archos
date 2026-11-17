import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ResourceSharingState } from '@/lib/sharing/types'

const hub = vi.hoisted(() => ({
  connectionListeners: new Set<(connected: boolean) => void>(),
}))
vi.mock('../lib/event-hub', () => ({
  subscribeToEvents: () => () => {},
  subscribeToConnection: (listener: (connected: boolean) => void) => {
    hub.connectionListeners.add(listener)
    listener(true)
    return () => hub.connectionListeners.delete(listener)
  },
}))

import { useMentionCandidates, useSharing } from './use-sharing'

const RESOURCE_ID = 's_conv_new'
const URL = `/api/sharing/conversation/${RESOURCE_ID}`

const LADDER_MS = 500 + 1_000 + 2_000 + 4_000
const LADDER_RUNGS = 4

const sharingState = (): ResourceSharingState => ({
  resourceType: 'conversation',
  resourceId: RESOURCE_ID,
  visibility: 'private',
  allowedVisibilities: ['private', 'project', 'organization'],
  myRole: 'owner',
  canManage: true,
  canEscalate: false,
  entries: [],
  shared: false,
})

const ok = (): Response =>
  ({ ok: true, status: 200, json: async () => sharingState() }) as unknown as Response

const notFound = (): Response =>
  ({ ok: false, status: 404, json: async () => ({ error: 'not-found' }) }) as unknown as Response

const fetchMock = vi.fn<(input: string) => Promise<Response>>()

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  hub.connectionListeners.clear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const tick = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

const runLadder = () => tick(LADDER_MS)

describe('useSharing — a resource the server does not have yet', () => {
  test('converges once the conversation lands, with nothing prompting it', async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValue(ok())

    const { result } = renderHook(() => useSharing('conversation', RESOURCE_ID, true))

    await tick(0)
    expect(result.current.state).toBeNull()

    await runLadder()

    expect(result.current.state).not.toBeNull()
    expect(result.current.state?.resourceId).toBe(RESOURCE_ID)
    expect(result.current.loadError).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  test('reports loading, not failure, while the ladder is still walking', async () => {
    fetchMock.mockResolvedValue(notFound())

    const { result } = renderHook(() => useSharing('conversation', RESOURCE_ID, true))

    await tick(600)

    expect(result.current.loadError).toBe(false)
    expect(result.current.loading).toBe(true)
  })

  test('gives up after the ladder rather than polling a resource that is gone', async () => {
    fetchMock.mockResolvedValue(notFound())

    const { result } = renderHook(() => useSharing('conversation', RESOURCE_ID, true))

    await runLadder()
    expect(result.current.loadError).toBe(true)
    expect(result.current.loading).toBe(false)

    const attempts = fetchMock.mock.calls.length
    expect(attempts).toBe(1 + LADDER_RUNGS)

    await tick(600_000)
    expect(fetchMock).toHaveBeenCalledTimes(attempts)
  })

  test('a manual refresh walks a fresh ladder after the first one is spent', async () => {
    fetchMock.mockResolvedValue(notFound())

    const { result } = renderHook(() => useSharing('conversation', RESOURCE_ID, true))
    await runLadder()
    expect(result.current.loadError).toBe(true)

    fetchMock.mockResolvedValue(ok())
    act(() => result.current.refresh())
    await tick(0)

    expect(result.current.state).not.toBeNull()
    expect(result.current.loadError).toBe(false)
  })

  test('switching resource abandons the retry in flight', async () => {
    fetchMock.mockResolvedValue(notFound())

    const { rerender } = renderHook(
      ({ id }: { id: string }) => useSharing('conversation', id, true),
      { initialProps: { id: RESOURCE_ID } },
    )
    await tick(0)

    fetchMock.mockClear()
    fetchMock.mockResolvedValue(ok())
    rerender({ id: 's_conv_other' })
    await runLadder()

    expect(fetchMock.mock.calls.length).toBeGreaterThan(0)
    for (const [input] of fetchMock.mock.calls) {
      expect(input).toBe('/api/sharing/conversation/s_conv_other')
    }
  })

  test('a gated org asks nothing and schedules nothing', async () => {
    const { result } = renderHook(() => useSharing('conversation', RESOURCE_ID, false))

    await runLadder()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.state).toBeNull()
    expect(result.current.loading).toBe(false)
  })
})

describe('useSharing — the ordinary path', () => {
  test('reads once when the resource is already there', async () => {
    fetchMock.mockResolvedValue(ok())

    const { result } = renderHook(() => useSharing('conversation', RESOURCE_ID, true))

    await tick(0)
    expect(result.current.state).not.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(URL)

    await runLadder()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

const CONVERSATION_ID = 's_conv_new'
const MENTION_URL = `/api/conversations/${CONVERSATION_ID}/mention-candidates`

const candidates = (): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ kind: 'agent', id: 'agent', name: 'Piloti' }] }),
  }) as unknown as Response

describe('useMentionCandidates — before the conversation exists', () => {
  test('asks nothing at all while there is no conversation id', async () => {
    const { result } = renderHook(() => useMentionCandidates(null, true))

    await runLadder()
    act(() => result.current.restart())
    await runLadder()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  test('gives up after the ladder when the row is genuinely absent', async () => {
    fetchMock.mockResolvedValue(notFound())

    const { result } = renderHook(() => useMentionCandidates(CONVERSATION_ID, true))

    await runLadder()

    expect(fetchMock).toHaveBeenCalledTimes(LADDER_RUNGS + 1)
    expect(fetchMock).toHaveBeenCalledWith(MENTION_URL)
    expect(result.current.data).toBeNull()
    expect(result.current.loading).toBe(false)
  })

  test('a restart against a row that is STILL missing only burns the ladder again', async () => {
    fetchMock.mockResolvedValue(notFound())
    const { result } = renderHook(() => useMentionCandidates(CONVERSATION_ID, true))
    await runLadder()
    fetchMock.mockClear()

    act(() => result.current.restart())
    await runLadder()

    expect(fetchMock).toHaveBeenCalledTimes(LADDER_RUNGS + 1)
    expect(result.current.data).toBeNull()
  })

  test('converges the moment the row appears, with nothing prompting it', async () => {
    fetchMock.mockResolvedValueOnce(notFound()).mockResolvedValue(candidates())

    const { result } = renderHook(() => useMentionCandidates(CONVERSATION_ID, true))

    await runLadder()

    expect(result.current.data).not.toBeNull()
    expect(result.current.loading).toBe(false)
  })

  test('a gated org asks nothing and schedules nothing', async () => {
    const { result } = renderHook(() => useMentionCandidates(CONVERSATION_ID, false))

    await runLadder()

    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.data).toBeNull()
  })
})
