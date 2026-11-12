/**
 * @vitest-environment node
 *
 * The sweeps that had a route and no caller until they became cron tasks
 * (ADR-0150): collaboration retention, the platform lessons' clock, and the
 * Frist reminder, which the engine now starts at the office's 06:45.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const pruneExpiredInboxItems = vi.fn<() => Promise<{ deleted: number; cutoff: string }>>()
const sweepOrphanedCollaborationRows = vi.fn<() => Promise<{ grants: number; requests: number; inboxItems: number }>>()
vi.mock('@/lib/collaboration/retention', () => ({ pruneExpiredInboxItems: () => pruneExpiredInboxItems() }))
vi.mock('@/lib/collaboration/cleanup', () => ({ sweepOrphanedCollaborationRows: () => sweepOrphanedCollaborationRows() }))
const runScheduledLessonSweep = vi.fn()
vi.mock('@/lib/platform-lessons/service', () => ({ runScheduledLessonSweep: () => runScheduledLessonSweep() }))
const enqueueDueReminders = vi.fn(async (_now: Date) => ({ day: '2026-07-15', organizations: 2, queued: 2, already: 0 }))
vi.mock('@/lib/annotations/due-reminders', () => ({ enqueueDueReminders: (now: Date) => enqueueDueReminders(now) }))

const NOTHING = { grants: 0, requests: 0, inboxItems: 0 }
const CUTOFF = '2026-01-01T00:00:00.000Z'

afterEach(() => {
  vi.restoreAllMocks()
  pruneExpiredInboxItems.mockReset()
  sweepOrphanedCollaborationRows.mockReset()
  runScheduledLessonSweep.mockReset()
  enqueueDueReminders.mockClear()
})

describe('sweepCollaborationRetention', () => {
  it('asks again while a round deleted something, and logs the totals once', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    pruneExpiredInboxItems
      .mockResolvedValueOnce({ deleted: 1000, cutoff: CUTOFF })
      .mockResolvedValueOnce({ deleted: 40, cutoff: CUTOFF })
      .mockResolvedValue({ deleted: 0, cutoff: CUTOFF })
    sweepOrphanedCollaborationRows.mockResolvedValueOnce({ grants: 2, requests: 1, inboxItems: 500 }).mockResolvedValue(NOTHING)
    const { sweepCollaborationRetention } = await import('./sweeps')

    await sweepCollaborationRetention()

    expect(pruneExpiredInboxItems).toHaveBeenCalledTimes(3)
    expect(sweepOrphanedCollaborationRows).toHaveBeenCalledTimes(3)
    expect(log.mock.calls.map(String)).toEqual([
      expect.stringContaining('collaboration retention: {"expired":1040,"grants":2,"requests":1,"inboxItems":500}'),
    ])
  })

  it('stops at its bound when the backlog does not end, and says nothing when there was none', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    pruneExpiredInboxItems.mockResolvedValue({ deleted: 1000, cutoff: CUTOFF })
    sweepOrphanedCollaborationRows.mockResolvedValue(NOTHING)
    const { sweepCollaborationRetention } = await import('./sweeps')

    await sweepCollaborationRetention()
    expect(pruneExpiredInboxItems).toHaveBeenCalledTimes(20)

    log.mockClear()
    pruneExpiredInboxItems.mockReset().mockResolvedValue({ deleted: 0, cutoff: CUTOFF })
    await sweepCollaborationRetention()
    expect(pruneExpiredInboxItems).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })
})

describe('sweepPlatformLessons', () => {
  it('runs one bounded sweep, logs it when a report was processed, and fails the run when the sweep throws', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sweepPlatformLessons } = await import('./sweeps')

    runScheduledLessonSweep.mockResolvedValueOnce({ processed: 0, created: 0, linked: 0, skipped: 0, deferred: 0 })
    await sweepPlatformLessons()
    expect(log).not.toHaveBeenCalled()

    runScheduledLessonSweep.mockResolvedValueOnce({ processed: 3, created: 1, linked: 2, skipped: 0, deferred: 0 })
    await sweepPlatformLessons()
    expect(log.mock.calls.map(String)).toEqual([expect.stringContaining('platform lessons: {"processed":3')])
    expect(runScheduledLessonSweep).toHaveBeenCalledTimes(2)

    runScheduledLessonSweep.mockRejectedValueOnce(new Error('database away'))
    await expect(sweepPlatformLessons()).rejects.toThrow('database away')
  })
})

describe('sweepFristReminder', () => {
  it('queues the reminders whenever it runs: the hour is the cron\'s, not a gate here', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const { sweepFristReminder } = await import('./sweeps')
    // 15:00 in Vienna: a retry after backoff, or a run somebody triggered by hand.
    const afternoon = new Date('2026-07-15T13:00:00Z')

    await sweepFristReminder(afternoon)

    expect(enqueueDueReminders).toHaveBeenCalledWith(afternoon)
  })
})
