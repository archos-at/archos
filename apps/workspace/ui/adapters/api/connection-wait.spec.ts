/**
 * @vitest-environment node
 */
/**
 * The wait for a connection, as the chat and the review canvas both read it:
 * `connecting` and `reconnecting` count across the attempts, and every status
 * with a meaning of its own ends the wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CONNECTION_WAIT_NOTE_AFTER_MS, watchConnectionWait } from './connection-wait'
import type { TurnSocketStatus } from './turn-socket-machine'

const setup = () => {
  const told: boolean[] = []
  const passed: TurnSocketStatus[] = []
  const status = watchConnectionWait(
    (waiting) => told.push(waiting),
    (next) => passed.push(next)
  )
  return { told, passed, status }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('the wait for a connection', () => {
  it('hands every status on, in order', () => {
    const { passed, status } = setup()
    for (const next of ['connecting', 'open', 'reconnecting', 'failed'] as const) status(next)
    expect(passed).toEqual(['connecting', 'open', 'reconnecting', 'failed'])
  })

  it('counts a first connect that does not open, and says nothing for one that does', () => {
    const quick = setup()
    quick.status('connecting')
    vi.advanceTimersByTime(CONNECTION_WAIT_NOTE_AFTER_MS - 1)
    quick.status('open')
    vi.advanceTimersByTime(CONNECTION_WAIT_NOTE_AFTER_MS)
    expect(quick.told).toEqual([])

    const slow = setup()
    slow.status('connecting')
    vi.advanceTimersByTime(CONNECTION_WAIT_NOTE_AFTER_MS)
    expect(slow.told).toEqual([true])
    slow.status('open')
    expect(slow.told).toEqual([true, false])
  })

  it('runs one wait across the attempts of the ladder', () => {
    const { told, status } = setup()
    status('reconnecting')
    vi.advanceTimersByTime(CONNECTION_WAIT_NOTE_AFTER_MS - 1)
    status('connecting')
    status('reconnecting')
    vi.advanceTimersByTime(1)
    expect(told).toEqual([true])
  })

  it.each(['open', 'closed', 'suspended', 'offline', 'failed', 'incompatible', 'outdated'] as const)(
    'ends on %s, before the moment is over and after',
    (end) => {
      const early = setup()
      early.status('connecting')
      early.status(end)
      vi.advanceTimersByTime(CONNECTION_WAIT_NOTE_AFTER_MS * 2)
      expect(early.told).toEqual([])

      const late = setup()
      late.status('reconnecting')
      vi.advanceTimersByTime(CONNECTION_WAIT_NOTE_AFTER_MS)
      late.status(end)
      expect(late.told).toEqual([true, false])
    }
  )

  it('starts a new wait when the page comes back from being hidden', () => {
    const { told, status } = setup()
    status('suspended')
    status('connecting')
    vi.advanceTimersByTime(CONNECTION_WAIT_NOTE_AFTER_MS)
    expect(told).toEqual([true])
  })
})
