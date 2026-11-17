import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useBimComplianceDiff } from './use-bim-model'

const NO_FACTS = { buildingClass: null, mainUse: null }

let fetchMock: ReturnType<typeof vi.fn>

function deferred(): { promise: Promise<unknown>; resolve: (value: unknown) => void } {
  let resolve!: (value: unknown) => void
  const promise = new Promise<unknown>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

const ok = (changes: unknown[]) => ({ ok: true, json: async () => ({ complianceChanges: changes }) })

const change = (ruleId: string) => ({ ruleId, trend: 'broken' })

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useBimComplianceDiff', () => {
  it('runs only when asked, not on mount', () => {
    renderHook(() => useBimComplianceDiff('m-new', 'm-old', NO_FACTS))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports the changes the comparison found', async () => {
    fetchMock.mockResolvedValue(ok([change('oib-2-1')]))
    const { result } = renderHook(() => useBimComplianceDiff('m-new', 'm-old', NO_FACTS))

    act(() => result.current.run())
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data?.changes).toEqual([change('oib-2-1')])
  })

  it('discards a result when the revision it compared is no longer the one selected', async () => {
    fetchMock.mockResolvedValue(ok([change('oib-2-1')]))
    const { result, rerender } = renderHook(
      ({ base }: { base: string }) => useBimComplianceDiff('m-new', base, NO_FACTS),
      { initialProps: { base: 'm-old' } }
    )

    act(() => result.current.run())
    await waitFor(() => expect(result.current.data).not.toBeNull())

    rerender({ base: 'm-older' })
    expect(result.current.data).toBeNull()
    expect(result.current.isLoading).toBe(false)
  })

  it('discards a result when the building facts the rules read change under it', async () => {
    fetchMock.mockResolvedValue(ok([change('oib-2-1')]))
    const { result, rerender } = renderHook(
      ({ gk }: { gk: number }) =>
        useBimComplianceDiff('m-new', 'm-old', { buildingClass: gk, mainUse: null }),
      { initialProps: { gk: 3 } }
    )

    act(() => result.current.run())
    await waitFor(() => expect(result.current.data).not.toBeNull())

    rerender({ gk: 4 })
    expect(result.current.data).toBeNull()
  })

  it('lets the last run win when an earlier one answers later', async () => {
    const first = deferred()
    const second = deferred()
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const { result } = renderHook(() => useBimComplianceDiff('m-new', 'm-old', NO_FACTS))

    act(() => result.current.run())
    act(() => result.current.run())

    await act(async () => {
      second.resolve(ok([change('second')]))
      await second.promise
    })
    await act(async () => {
      first.resolve(ok([change('first')]))
      await first.promise
    })

    expect(result.current.data?.changes).toEqual([change('second')])
  })

  it('does not report a failure from a run that has been superseded', async () => {
    const first = deferred()
    fetchMock
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok([change('second')]))

    const { result } = renderHook(() => useBimComplianceDiff('m-new', 'm-old', NO_FACTS))
    act(() => result.current.run())
    act(() => result.current.run())
    await waitFor(() => expect(result.current.data).not.toBeNull())

    await act(async () => {
      first.resolve({ ok: false, status: 500, json: async () => ({}) })
      await first.promise.catch(() => undefined)
    })

    expect(result.current.error).toBeNull()
    expect(result.current.data?.changes).toEqual([change('second')])
  })

  it('does nothing when there is no previous revision to compare against', () => {
    const { result } = renderHook(() => useBimComplianceDiff('m-new', null, NO_FACTS))
    act(() => result.current.run())
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
