/**
 * One model list per project per moment, however many surfaces ask for it.
 *
 * The list stopped being one page's data. The chat welcome asks whether this
 * project has a readable model, the file preview asks which model belongs to
 * the document being previewed, its metadata rail asks what that model
 * contains, and every `ifc_viewer` card in a thread asks again. Each of those
 * mounts a separate hook, so opening a preview fired the identical request
 * three or four times within a tick — each spending a point of the `bim-query`
 * budget on rows the browser already had in flight.
 *
 * The collapse is in-flight only, deliberately: it can never show anyone a
 * stale model, so it needs no answer to "how old may this be".
 */

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

/** Deferred so several hooks can mount while the first request is unresolved. */
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
    // Every caller gets the answer, not just the one that happened to ask.
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
    // No TTL: a surface mounting later gets a fresh read, so a model that
    // finished extracting in between is not hidden behind a cached answer.
    const second = renderHook(() => useProjectBimModels('proj-1'))
    await waitFor(() => expect(second.result.current.isLoading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('makes no request at all without a project', () => {
    renderHook(() => useProjectBimModels(null))

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

/**
 * Polling for an extraction must not tear the viewer down.
 *
 * The list is read again while any model is still being read (on the shelf's
 * hint, and on a slow clock), and the effect that re-reads is the same one that loads. It used to blank
 * `data` on every run, so for the whole minute after an upload the list
 * emptied four times a minute — which took the stage's `modelId` to null,
 * unmounted the canvas, destroyed the WebGPU device and the WASM kernel, and
 * re-downloaded and re-triangulated the entire model on the next tick.
 */
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

    // The reload path is the poll's path — both bump the same tick.
    result.current.reload()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    // The refetch is in flight and the list is STILL there. Blanking it here
    // is what unmounted the canvas.
    expect(result.current.isLoading).toBe(true)
    expect(result.current.data).toHaveLength(1)
    gate.resolve()
  })

  it('does not carry one project’s models into another', async () => {
    // A stale row from the same project is a better answer than none; a row
    // from a different project is not an answer at all.
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

/**
 * A model that is still being read is waited for on the project shelf's live
 * channel: the server says `shelf.changed` when the extraction lands, and the
 * list is read again through its own route. The clock is only the floor.
 */
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
