import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TYPING_REFRESH_MS } from '@/lib/conversations/presence-contract'
import { useTypingBroadcast } from './use-typing-broadcast'

const fetchMock = vi.fn()

function posts(): Array<{ conversationId: string; typing: boolean }> {
  return fetchMock.mock.calls.map(([url, init]) => ({
    conversationId: String(url).split('/')[3],
    typing: JSON.parse(String((init as RequestInit).body)).typing as boolean,
  }))
}

describe('useTypingBroadcast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('posts nothing when disabled', () => {
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'conv_1', enabled: false })
    )
    act(() => result.current.onTyping())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('publishes once for a burst of keystrokes', () => {
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'conv_1', enabled: true })
    )
    act(() => {
      for (let i = 0; i < 40; i += 1) result.current.onTyping()
    })
    expect(posts()).toEqual([{ conversationId: 'conv_1', typing: true }])
  })

  it('republishes once the claim is due to expire', () => {
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'conv_1', enabled: true })
    )
    act(() => result.current.onTyping())
    act(() => {
      vi.advanceTimersByTime(TYPING_REFRESH_MS + 1)
      result.current.onTyping()
    })
    expect(posts()).toHaveLength(2)
    expect(posts().every((p) => p.typing)).toBe(true)
  })

  it('withdraws the claim when the draft is cleared', () => {
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'conv_1', enabled: true })
    )
    act(() => result.current.onTyping())
    act(() => result.current.onStoppedTyping())
    expect(posts()).toEqual([
      { conversationId: 'conv_1', typing: true },
      { conversationId: 'conv_1', typing: false },
    ])
  })

  it('does not withdraw a claim it never made', () => {
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'conv_1', enabled: true })
    )
    act(() => result.current.onStoppedTyping())
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('withdraws on unmount', () => {
    const { result, unmount } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'conv_1', enabled: true })
    )
    act(() => result.current.onTyping())
    unmount()
    expect(posts().at(-1)).toEqual({ conversationId: 'conv_1', typing: false })
  })

  it('withdraws on the OLD thread when the conversation changes', () => {
    const { result, rerender } = renderHook(
      (props: { conversationId: string }) =>
        useTypingBroadcast({ conversationId: props.conversationId, enabled: true }),
      { initialProps: { conversationId: 'conv_1' } }
    )
    act(() => result.current.onTyping())
    rerender({ conversationId: 'conv_2' })
    expect(posts().at(-1)).toEqual({ conversationId: 'conv_1', typing: false })
  })

  it('never surfaces a failed publish', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'conv_1', enabled: true })
    )
    expect(() => act(() => result.current.onTyping())).not.toThrow()
  })
})

describe('a pause is not a stop', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps the claim alive while the composer sits idle mid-sentence', () => {
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'c-1', enabled: true })
    )
    act(() => result.current.onTyping())
    const afterFirstKeystroke = posts().length

    act(() => {
      vi.advanceTimersByTime(TYPING_REFRESH_MS * 3)
    })
    const later = posts()
    expect(later.length).toBeGreaterThan(afterFirstKeystroke)
    expect(later.at(-1)).toEqual({ conversationId: 'c-1', typing: true })
  })

  it('withdraws rather than claiming forever when the draft is abandoned', () => {
    const { result } = renderHook(() =>
      useTypingBroadcast({ conversationId: 'c-1', enabled: true })
    )
    act(() => result.current.onTyping())
    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    expect(posts().at(-1)).toEqual({ conversationId: 'c-1', typing: false })
  })
})
