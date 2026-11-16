import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { BIM_ELEMENTS_PAGE_LIMIT } from '@/lib/bim/types'
import { useBimElements } from './use-bim-model'

const MODEL_ID = 'model-1'

function requestedPages(fetchMock: ReturnType<typeof vi.fn>): Array<{ limit: number; offset: number }> {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string))
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useBimElements', () => {
  it('asks for the largest page the API will serve', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ elements: [] }) })

    const { result } = renderHook(() => useBimElements(MODEL_ID))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(requestedPages(fetchMock)[0].limit).toBe(BIM_ELEMENTS_PAGE_LIMIT)
  })

  it('walks a whole model in pages, stopping on a short one', async () => {
    const total = BIM_ELEMENTS_PAGE_LIMIT * 2 + 1
    const full = Array.from({ length: BIM_ELEMENTS_PAGE_LIMIT }, (_, i) => ({ expressId: i }))
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: full, total }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ elements: full, total }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ elements: [{ expressId: 9 }], total }),
      })

    const { result } = renderHook(() => useBimElements(MODEL_ID))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    const pages = requestedPages(fetchMock)
    expect(pages).toHaveLength(3)
    expect(pages.map((page) => page.offset).sort((a, b) => a - b)).toEqual([
      0,
      BIM_ELEMENTS_PAGE_LIMIT,
      BIM_ELEMENTS_PAGE_LIMIT * 2,
    ])
    expect(result.current.data).toHaveLength(total)
  })

  it('costs one request for a model that fits in a single page', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ elements: [{ expressId: 1 }], total: 1 }),
    })

    const { result } = renderHook(() => useBimElements(MODEL_ID))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps walking past a total that is only a lower bound', async () => {
    const full = Array.from({ length: BIM_ELEMENTS_PAGE_LIMIT }, (_, i) => ({ expressId: i }))
    const capped = { total: BIM_ELEMENTS_PAGE_LIMIT, totalIsLowerBound: true }
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      const { offset } = JSON.parse(init.body as string)
      const elements = offset < BIM_ELEMENTS_PAGE_LIMIT * 3 ? full : []
      return Promise.resolve({ ok: true, json: async () => ({ elements, ...capped }) })
    })

    const { result } = renderHook(() => useBimElements(MODEL_ID))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    expect(result.current.data).toHaveLength(BIM_ELEMENTS_PAGE_LIMIT * 3)
  })

  it('keeps a full walk inside the route’s own rate-limit budget', async () => {
    const { BIM_ELEMENT_LIMIT } = await import('@/lib/bim/service')
    const { BIM_QUERY_LIMIT } = await import('@/lib/limits')

    expect(Math.ceil(BIM_ELEMENT_LIMIT / BIM_ELEMENTS_PAGE_LIMIT)).toBeLessThan(BIM_QUERY_LIMIT.limit)
  })
})
