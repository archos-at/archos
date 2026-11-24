import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { answerTrailFor, forgetAnswerTrails } from './answer-trails'

const trail = (messageId: string) => ({ messageId, places: [], personalMemory: true, personalShelf: false, solo: true })
const page = (answers: unknown[], nextCursor: string | null = null) =>
  new Response(JSON.stringify({ answers, nextCursor }), { status: 200 })

beforeEach(() => {
  forgetAnswerTrails()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('answerTrailFor', () => {
  it('reads a chat’s trails once, every page, for all of its answers', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(page([trail('a2')], 'a2'))
      .mockResolvedValueOnce(page([trail('a1')]))

    expect(await answerTrailFor('s_c', 'a1')).toMatchObject({ messageId: 'a1' })
    expect(await answerTrailFor('s_c', 'a2')).toMatchObject({ messageId: 'a2' })
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(String(fetch.mock.calls[1]?.[0])).toContain('cursor=a2')
  })

  it('reads again for an answer newer than what it holds, at most once in ten seconds', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(page([trail('a1')]))
    await answerTrailFor('s_c', 'a1')

    expect(await answerTrailFor('s_c', 'old')).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(10_001)
    fetch.mockResolvedValueOnce(page([trail('a1'), trail('a3')]))
    expect(await answerTrailFor('s_c', 'a3')).toMatchObject({ messageId: 'a3' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('forgets a failed read, so the next answer asks again', async () => {
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 403 }))
      .mockResolvedValueOnce(page([trail('a1')]))

    await expect(answerTrailFor('s_c', 'a1')).rejects.toThrow()
    expect(await answerTrailFor('s_c', 'a1')).toMatchObject({ messageId: 'a1' })
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
