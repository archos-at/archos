import { renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { useComposerArriving } from './use-composer-arrival'

describe('useComposerArriving', () => {
  test('holds until the session is confirmed, then ends', () => {
    const { result, rerender } = renderHook(({ authed }) => useComposerArriving(authed), { initialProps: { authed: false } })
    expect(result.current).toBe(true)

    rerender({ authed: true })
    expect(result.current).toBe(false)
  })

  test('is over at once for a composer that mounts already signed in, as after a switch', () => {
    const { result, rerender } = renderHook(({ authed }) => useComposerArriving(authed), { initialProps: { authed: true } })
    expect(result.current).toBe(false)

    rerender({ authed: false })
    expect(result.current).toBe(false)
  })
})
