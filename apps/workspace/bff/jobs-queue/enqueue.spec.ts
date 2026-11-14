/**
 * @vitest-environment node
 *
 * An enqueue stores the row, then starts its run without waiting (ADR-0150);
 * a job keyed on what it is about starts a run only for a row this call stored.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const insertJob = vi.fn(async () => 'job-1')
const insertJobIfAbsent = vi.fn(async () => true)
vi.mock('./repository', () => ({
  insertJob: (...args: unknown[]) => insertJob(...(args as [])),
  insertJobIfAbsent: (...args: unknown[]) => insertJobIfAbsent(...(args as [])),
}))
const triggerBffJob = vi.fn(async () => {})
vi.mock('./orchestrator', () => ({ triggerBffJob: (...args: unknown[]) => triggerBffJob(...(args as [])) }))

const { enqueueJobIfAbsent } = await import('./enqueue')
const { BFF_JOB_PRIORITY } = await import('./types')
const job = { kind: 'inbound_mail_receive', organizationId: 'org_1', payload: { mailId: 'm1' }, jobId: 'm1' } as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('enqueueJobIfAbsent', () => {
  it('stores the job and starts its run, bulk unless asked, with ids and the priority only', async () => {
    expect(await enqueueJobIfAbsent(job)).toBe(true)

    expect(insertJobIfAbsent).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'm1', priority: BFF_JOB_PRIORITY.bulk }), undefined)
    expect(triggerBffJob).toHaveBeenCalledWith(
      { job_id: 'm1', kind: 'inbound_mail_receive', organization_id: 'org_1', priority: 'bulk', generation: 0 },
      {}
    )
  })

  it('starts nothing for a job that was already there', async () => {
    insertJobIfAbsent.mockResolvedValueOnce(false)

    expect(await enqueueJobIfAbsent(job)).toBe(false)
    expect(triggerBffJob).not.toHaveBeenCalled()
  })

  it('keeps the stored job when its run cannot start: the dispatch sweep starts it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    triggerBffJob.mockRejectedValueOnce(new Error('engine away'))

    expect(await enqueueJobIfAbsent({ ...job, priority: BFF_JOB_PRIORITY.interactive, notBefore: new Date(Date.now() + 60_000) })).toBe(true)
    expect(triggerBffJob).toHaveBeenCalledWith(expect.objectContaining({ priority: 'interactive' }), { notBefore: expect.any(Date) })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
