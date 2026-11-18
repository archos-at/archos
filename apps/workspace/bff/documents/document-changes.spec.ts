import { renderHook, act } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import {
  notifyDocumentsChanged,
  onDocumentsChanged,
  useDocumentsGeneration,
} from './document-changes'

describe('document change notifications', () => {
  it('tells every listener', () => {
    const first = vi.fn()
    const second = vi.fn()
    const offFirst = onDocumentsChanged(first)
    const offSecond = onDocumentsChanged(second)

    notifyDocumentsChanged()

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
    offFirst()
    offSecond()
  })

  it('stops telling one that unsubscribed', () => {
    const listener = vi.fn()
    onDocumentsChanged(listener)()

    notifyDocumentsChanged()

    expect(listener).not.toHaveBeenCalled()
  })

  it('a listener that unsubscribes itself does not make the next one miss out', () => {
    const calls: string[] = []
    const off = onDocumentsChanged(() => {
      calls.push('first')
      off()
    })
    const offSecond = onDocumentsChanged(() => calls.push('second'))

    notifyDocumentsChanged()

    expect(calls).toEqual(['first', 'second'])
    offSecond()
  })

  it('one throwing listener does not stop the rest being told', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const after = vi.fn()
    const offBad = onDocumentsChanged(() => {
      throw new Error('boom')
    })
    const offAfter = onDocumentsChanged(after)

    notifyDocumentsChanged()

    expect(after).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalled()
    offBad()
    offAfter()
    warn.mockRestore()
  })

  it('a mounted surface is told, not only the next one to mount', () => {
    const { result } = renderHook(() => useDocumentsGeneration())
    const before = result.current

    act(() => notifyDocumentsChanged())

    expect(result.current).not.toBe(before)
  })

  it('a subscriber that reloads on the bump sees the CLEARED cache, never the stale one', () => {
    let cache: string | null = 'stale listing'
    const off = onDocumentsChanged(() => {
      cache = null
    })

    const seen: (string | null)[] = []
    const { result } = renderHook(() => {
      const generation = useDocumentsGeneration()
      seen[generation] = cache
      return generation
    })
    const before = result.current

    act(() => notifyDocumentsChanged())

    expect(result.current).toBe(before + 1)
    expect(seen[result.current]).toBeNull()
    off()
  })
})
