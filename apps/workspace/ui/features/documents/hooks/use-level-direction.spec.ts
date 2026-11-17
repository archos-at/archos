import { describe, expect, it } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useLevelDirection } from './use-level-direction'

describe('useLevelDirection', () => {
  it('reports no direction before anything has been navigated', () => {
    expect(renderHook(() => useLevelDirection(0)).result.current).toBe(0)
    expect(renderHook(() => useLevelDirection(3)).result.current).toBe(0)
  })

  it('reports deeper as 1 and shallower as -1', () => {
    const { result, rerender } = renderHook(({ depth }) => useLevelDirection(depth), {
      initialProps: { depth: 0 },
    })

    rerender({ depth: 1 })
    expect(result.current).toBe(1)

    rerender({ depth: 2 })
    expect(result.current).toBe(1)

    rerender({ depth: 1 })
    expect(result.current).toBe(-1)

    rerender({ depth: 0 })
    expect(result.current).toBe(-1)
  })

  it('keeps the last direction across a re-render that is not a navigation', () => {
    const { result, rerender } = renderHook(({ depth }) => useLevelDirection(depth), {
      initialProps: { depth: 0 },
    })

    rerender({ depth: 1 })
    expect(result.current).toBe(1)

    rerender({ depth: 1 })
    rerender({ depth: 1 })
    expect(result.current).toBe(1)
  })

  it('survives the same depth being rendered twice, which is what broke it', () => {
    const { result, rerender } = renderHook(({ depth }) => useLevelDirection(depth), {
      initialProps: { depth: 2 },
    })

    rerender({ depth: 3 })
    rerender({ depth: 3 })
    expect(result.current).toBe(1)
  })
})
