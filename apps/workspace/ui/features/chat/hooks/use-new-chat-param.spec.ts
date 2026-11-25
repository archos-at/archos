import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@/test-utils'
import { useNewChatParam } from './use-new-chat-param'

describe('?new=1 starts a new chat every time „Neuer Chat“ is pressed', () => {
  it('starts one once per arrival of the parameter', () => {
    const start = vi.fn()
    const { rerender } = renderHook(({ param }) => useNewChatParam(param, true, start), {
      initialProps: { param: '1' as string | null },
    })
    rerender({ param: '1' })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it('starts another when the page, still mounted, gets ?new=1 again after the first was consumed', () => {
    const start = vi.fn()
    const { rerender } = renderHook(({ param }) => useNewChatParam(param, true, start), {
      initialProps: { param: '1' as string | null },
    })
    rerender({ param: null })
    rerender({ param: '1' })
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('waits for sign-in before starting', () => {
    const start = vi.fn()
    const { rerender } = renderHook(({ ready }) => useNewChatParam('1', ready, start), {
      initialProps: { ready: false },
    })
    expect(start).not.toHaveBeenCalled()
    rerender({ ready: true })
    expect(start).toHaveBeenCalledTimes(1)
  })
})
