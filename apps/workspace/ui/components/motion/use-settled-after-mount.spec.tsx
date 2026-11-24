import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useSettledAfterMount } from './use-settled-after-mount'

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a surface holds its transitions until it first stands ready', () => {
  test('controls that mount disabled and then enable take their enabled look at once, not over a transition', () => {
    const { result, rerender } = renderHook(({ ready }) => useSettledAfterMount(ready), { initialProps: { ready: false } })
    expect(result.current).toBe(false)

    rerender({ ready: true })
    expect(result.current).toBe(false)
    act(() => {
      vi.advanceTimersToNextFrame()
      vi.advanceTimersToNextFrame()
    })
    expect(result.current).toBe(true)
  })

  test('the reader’s first press or key settles it even while it is not ready', () => {
    const { result } = renderHook(() => useSettledAfterMount(false))

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }))
    })
    expect(result.current).toBe(true)
  })
})
