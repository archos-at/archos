import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { scriptedChannels, type ScriptedChannels } from '@/test-utils/live-channels'
import { EXTRACTION_FALLBACK_POLL_MS, useProjectBimModels } from './use-bim-model'

const live = vi.hoisted(() => ({ current: null as ScriptedChannels | null }))
vi.mock('@/features/realtime/connection', async (original) => ({
  ...(await original<typeof import('@/features/realtime/connection')>()),
  getRealtimeConnection: () => live.current!.connection,
}))

let fetchMock: ReturnType<typeof vi.fn>

function pending(): { resolve: () => void; promise: Promise<unknown> } {
  let release: () => void = () => {}
  const promise = new Promise<unknown>((done) => {
    release = () =>
      done({
        ok: true,
        json: async () => ({ models: [{ id: 'model-1', status: 'ready' }] }),
      })
  })
  return { resolve: release, promise }
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  live.current = scriptedChannels((ms) => vi.advanceTimersByTime(ms))
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useProjectBimModels', () => {
  it('asks once when several surfaces ask at the same moment', async () => {
    const gate = pending()
    fetchMock.mockReturnValue(gate.promise)

    const first = renderHook(() => useProjectBimModels('proj-1'))
    const second = renderHook(() => useProjectBimModels('proj-1'))
    const third = renderHook(() => useProjectBimModels('proj-1'))

    expect(fetchMock).toHaveBeenCalledTimes(1)

    gate.resolve()
    for (const hook of [first, second, third]) {
      await waitFor(() => expect(hook.result.current.data).toHaveLength(1))
    }
  })

  it('keeps two projects apart', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ models: [] }) })

    const a = renderHook(() => useProjectBimModels('proj-1'))
    const b = renderHook(() => useProjectBimModels('proj-2'))
    await waitFor(() => expect(a.result.current.isLoading).toBe(false))
    await waitFor(() => expect(b.result.current.isLoading).toBe(false))

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      '/api/projects/proj-1/bim/models',
      '/api/projects/proj-2/bim/models',
    ])
  })

  it('asks again after the shared request has settled', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ models: [] }) })

    const first = renderHook(() => useProjectBimModels('proj-1'))
    await waitFor(() => expect(first.result.current.isLoading).toBe(false))
    const second = renderHook(() => useProjectBimModels('proj-1'))
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('makes no request at all without a project', () => {
    renderHook(() => useProjectBimModels(null))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('refetching while a model is still being read', () => {
  const listing = (status: string) => ({
    ok: true,
    json: async () => ({ models: [{ id: 'model-1', status }] }),
  })

  it('keeps the models on screen while the next answer is in flight', async () => {
    const gate = pending()
    fetchMock.mockResolvedValueOnce(listing('extracting')).mockReturnValueOnce(gate.promise)

    const { result } = renderHook(() => useProjectBimModels('p1'))
    await waitFor(() => expect(result.current.data).toHaveLength(1))

    result.current.reload()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toHaveLength(1)
    gate.resolve()
  })

  it('does not carry one project’s models into another', async () => {
    fetchMock.mockResolvedValue(listing('ready'))
    const { result, rerender } = renderHook(({ id }) => useProjectBimModels(id), {
      initialProps: { id: 'p1' },
    })
    await waitFor(() => expect(result.current.data).toHaveLength(1))

    const gate = pending()
    fetchMock.mockReturnValueOnce(gate.promise)
    rerender({ id: 'p2' })

    expect(result.current.data).toBeNull()
    gate.resolve()
  })
})

describe('waiting for an extraction', () => {
  const listing = (status: string) => ({ ok: true, json: async () => ({ models: [{ id: 'model-1', status }] }) })
  const CHANGED = { kind: 'shelf.changed', folders: false }
  const landed = () => act(() => vi.advanceTimersByTimeAsync(0))

  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('reads the list once per hint on the project’s shelf, and stops listening once the model is ready', async () => {
    fetchMock.mockResolvedValueOnce(listing('extracting')).mockResolvedValue(listing('ready'))
    const { result } = renderHook(() => useProjectBimModels('proj-1'))
    await landed()
    expect(live.current!.open()).toEqual(['shelf:project-proj-1'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    live.current!.hint('shelf:project-proj-1', CHANGED)
    await landed()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.data?.[0]?.status).toBe('ready')
    expect(live.current!.open()).toEqual([])

    await act(() => vi.advanceTimersByTimeAsync(3 * EXTRACTION_FALLBACK_POLL_MS))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads nothing on another project’s hint', async () => {
    fetchMock.mockResolvedValue(listing('extracting'))
    renderHook(() => useProjectBimModels('proj-1'))
    await landed()
    live.current!.hint('shelf:project-proj-2', CHANGED)
    live.current!.hint('shelf:office_shelf', CHANGED)
    await landed()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('still reads on a slow clock when no hint comes', async () => {
    fetchMock.mockResolvedValue(listing('extracting'))
    renderHook(() => useProjectBimModels('proj-1'))
    await landed()
    await act(() => vi.advanceTimersByTimeAsync(EXTRACTION_FALLBACK_POLL_MS - 1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('opens no channel for a project whose models are all ready', async () => {
    fetchMock.mockResolvedValue(listing('ready'))
    renderHook(() => useProjectBimModels('proj-1'))
    await landed()
    expect(live.current!.open()).toEqual([])
  })
})
