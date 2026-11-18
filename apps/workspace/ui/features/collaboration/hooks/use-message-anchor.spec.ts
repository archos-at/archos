import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { messageIdFromHash, useMessageAnchor } from './use-message-anchor'

const setHash = (hash: string) => {
  window.history.replaceState(null, '', `/app/projects/p1/chat?session=s1${hash}`)
}

const scrollIntoView = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  document.body.innerHTML = ''
  window.history.replaceState(null, '', '/app/projects/p1/chat?session=s1')
  Element.prototype.scrollIntoView = scrollIntoView
  scrollIntoView.mockClear()
})

afterEach(() => {
  vi.useRealTimers()
})

const mountMessage = (id: string) => {
  const el = document.createElement('div')
  el.id = `message-${id}`
  document.body.appendChild(el)
}

describe('messageIdFromHash', () => {
  test('reads the message id', () => {
    expect(messageIdFromHash('#message-msg_7')).toBe('msg_7')
  })

  test('decodes it, so an id needing escaping still resolves', () => {
    expect(messageIdFromHash('#message-msg%2F7')).toBe('msg/7')
  })

  test('ignores every other hash, and no hash at all', () => {
    expect(messageIdFromHash('#report')).toBeNull()
    expect(messageIdFromHash('')).toBeNull()
    expect(messageIdFromHash(null)).toBeNull()
    expect(messageIdFromHash('#message-')).toBeNull()
  })
})

describe('useMessageAnchor', () => {
  test('does nothing without a message hash', () => {
    mountMessage('msg_7')

    const { result } = renderHook(() => useMessageAnchor(['msg_7']).highlightedId)

    expect(result.current).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  test('waits for the message to arrive, then scrolls to it and marks it', () => {
    setHash('#message-msg_7')

    const { result, rerender } = renderHook(({ ids }) => useMessageAnchor(ids).highlightedId, {
      initialProps: { ids: [] as string[] },
    })
    expect(result.current).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()

    mountMessage('msg_7')
    rerender({ ids: ['msg_7'] })

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(result.current).toBe('msg_7')
  })

  test('holds the target while the id is known but not yet painted', () => {
    setHash('#message-msg_7')

    const { result, rerender } = renderHook(({ ids }) => useMessageAnchor(ids).highlightedId, {
      initialProps: { ids: ['msg_7'] },
    })

    expect(result.current).toBeNull()

    mountMessage('msg_7')
    rerender({ ids: ['msg_7', 'msg_8'] })

    expect(result.current).toBe('msg_7')
  })

  test('the mark fades on its own', () => {
    setHash('#message-msg_7')
    mountMessage('msg_7')

    const { result } = renderHook(() => useMessageAnchor(['msg_7']).highlightedId)
    expect(result.current).toBe('msg_7')

    act(() => {
      vi.advanceTimersByTime(16)
    })
    act(() => {
      vi.advanceTimersByTime(2500)
    })
    expect(result.current).toBe('msg_7')
    act(() => {
      vi.advanceTimersByTime(200)
    })

    expect(result.current).toBeNull()
  })

  test('consumes the hash, so a reload leaves the reader where they are', () => {
    setHash('#message-msg_7')
    mountMessage('msg_7')

    renderHook(() => useMessageAnchor(['msg_7']).highlightedId)

    expect(window.location.hash).toBe('')
    expect(window.location.search).toBe('?session=s1')
  })

  test('a message that is never in the thread is simply ignored', () => {
    setHash('#message-msg_missing')
    mountMessage('msg_7')

    const { result } = renderHook(() => useMessageAnchor(['msg_7']).highlightedId)

    expect(result.current).toBeNull()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(window.location.hash).toBe('#message-msg_missing')
  })

  test('lands at once, not with a smooth scroll the mark fades during', () => {
    setHash('#message-msg_7')
    mountMessage('msg_7')

    renderHook(() => useMessageAnchor(['msg_7']))

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'center' })
  })

  test('tells the thread a target is pending, and when it landed', () => {
    setHash('#message-msg_7')
    const onLand = vi.fn()

    const { result, rerender } = renderHook(({ ids }) => useMessageAnchor(ids, { onLand }), {
      initialProps: { ids: [] as string[] },
    })
    expect(result.current.isTargetPending()).toBe(true)
    expect(onLand).not.toHaveBeenCalled()

    mountMessage('msg_7')
    rerender({ ids: ['msg_7'] })

    expect(onLand).toHaveBeenCalledWith('msg_7')
    expect(result.current.isTargetPending()).toBe(false)
  })

  test('takes up a hash that changes while the thread is open', () => {
    mountMessage('msg_7')
    mountMessage('msg_8')
    const { result } = renderHook(() => useMessageAnchor(['msg_7', 'msg_8']).highlightedId)
    expect(result.current).toBeNull()

    act(() => {
      window.history.replaceState(null, '', '/app/projects/p1/chat?session=s1#message-msg_8')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(result.current).toBe('msg_8')
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  describe('a target that never resolves', () => {
    type Props = { ids: string[]; conversationId: string | null; ready: boolean }
    const mount = (initialProps: Props) =>
      renderHook(
        ({ ids, conversationId, ready }: Props) => useMessageAnchor(ids, { conversationId, ready }),
        { initialProps }
      )

    test('stops holding a thread that loaded without it', () => {
      setHash('#message-msg_gone')
      const { result, rerender } = mount({ ids: [], conversationId: 's1', ready: false })
      expect(result.current.isTargetPending()).toBe(true)

      rerender({ ids: ['msg_7'], conversationId: 's1', ready: true })
      expect(result.current.isTargetPending()).toBe(false)
    })

    test('still lands when the message arrives after all (a shared thread\'s history)', () => {
      setHash('#message-msg_9')
      const { result, rerender } = mount({ ids: ['msg_7'], conversationId: 's1', ready: true })
      expect(result.current.isTargetPending()).toBe(false)

      mountMessage('msg_9')
      rerender({ ids: ['msg_7', 'msg_9'], conversationId: 's1', ready: true })
      expect(scrollIntoView).toHaveBeenCalledTimes(1)
      expect(result.current.highlightedId).toBe('msg_9')
    })

    test('is dropped when the reader leaves the thread it missed in', () => {
      setHash('#message-msg_gone')
      const { result, rerender } = mount({ ids: ['msg_7'], conversationId: 's1', ready: true })

      rerender({ ids: [], conversationId: 's2', ready: false })
      expect(result.current.isTargetPending()).toBe(false)
    })

    test('holds through the thread that was open when the link arrived, until its own thread opens', () => {
      setHash('#message-msg_9')
      const { result, rerender } = mount({ ids: ['msg_old'], conversationId: 'old', ready: true })
      rerender({ ids: [], conversationId: 's1', ready: false })
      expect(result.current.isTargetPending()).toBe(true)

      mountMessage('msg_9')
      rerender({ ids: ['msg_9'], conversationId: 's1', ready: true })
      expect(result.current.highlightedId).toBe('msg_9')
    })
  })
})
