/**
 * @vitest-environment node
 *
 * Project mail's sweeps as the `inbound-mail-sweep` cron task runs them
 * (ADR-0137, ADR-0150): what it logs, and when it fails its run.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InboundMailSweepResult } from '@/lib/inbound-mail/sweep'

vi.mock('server-only', () => ({}))
const sweepInboundMail = vi.fn<() => Promise<Partial<InboundMailSweepResult>>>()
vi.mock('@/lib/inbound-mail/sweep', () => ({ sweepInboundMail: () => sweepInboundMail() }))

afterEach(() => {
  vi.restoreAllMocks()
  sweepInboundMail.mockReset()
})

describe('sweepProjectMail', () => {
  it('logs each sweep that acted or saw an error, counts by name, and stays quiet for one that only looked', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    sweepInboundMail.mockResolvedValueOnce({
      expired: { checked: 3, errors: 0, expired: 2, parts: 5 },
      keptMails: { checked: 0, errors: 0, deleted: 0 },
      threads: { checked: 1, errors: 1, deleted: 0, entries: 0, originals: 0 },
    })
    const { sweepProjectMail } = await import('./sweeps')

    await sweepProjectMail(new Date())

    expect(log.mock.calls.map(([line]) => line)).toEqual([
      '[scheduling] project mail expired: checked 3, errors 0, expired 2, parts 5',
      '[scheduling] project mail threads: checked 1, errors 1, deleted 0, entries 0, originals 0',
    ])
  })

  it('fails the run when a sweep threw whole, naming the sweeps, after logging every one', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    sweepInboundMail.mockResolvedValueOnce({
      staleReceptions: { checked: 0, errors: 1, failed: 1 },
      expired: { checked: 2, errors: 0, expired: 1, parts: 1 },
    })
    const { sweepProjectMail } = await import('./sweeps')

    await expect(sweepProjectMail(new Date())).rejects.toThrow('project mail sweeps failed: staleReceptions')
    expect(log).toHaveBeenCalledWith('[scheduling] project mail expired: checked 2, errors 0, expired 1, parts 1')
  })

  it('does not fail the run for rows that failed: they are counted and the next run tries them again', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    sweepInboundMail.mockResolvedValueOnce({ orphanedReceptions: { checked: 4, errors: 2, requeued: 2 } })
    const { sweepProjectMail } = await import('./sweeps')

    await expect(sweepProjectMail(new Date())).resolves.toBeUndefined()
  })
})
