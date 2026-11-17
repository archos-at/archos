/**
 * @vitest-environment node
 *
 * A job that goes dead fails the documents it left at `processing` in the same
 * run, not at the sweep's next pass: when that write is made (only once the
 * row says `dead`, on each of the three ways there), and that it can never
 * change what the run answers. The write itself, against Postgres, is
 * `documents/stuck-processing.integration.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/tenant-context', () => ({
  runWithTenantSlot: <T,>(fn: () => Promise<T>) => fn(),
  withPlatformAccess: <T,>(_why: string, fn: () => Promise<T>) => fn(),
}))
const queue = vi.hoisted(() => ({
  attempts: 1,
  failJob: vi.fn<() => Promise<'queued' | 'dead' | null>>(),
  killJob: vi.fn<() => Promise<void>>(),
  failDocumentsOfDeadJob: vi.fn<(jobId: string) => Promise<unknown>>(),
  slice: vi.fn<() => Promise<unknown>>(),
}))
vi.mock('./repository', () => ({
  takeJob: async (jobId: string, holder: string) => ({ jobId, claimedBy: holder, kind: 'office_rendition', lane: 'org-1', payload: {}, attempts: queue.attempts }),
  heartbeatJob: async () => true,
  failJob: queue.failJob,
  killJob: queue.killJob,
}))
vi.mock('./run', () => ({
  UnknownJobKindError: class UnknownJobKindError extends Error {},
  runHandler: queue.slice,
}))
vi.mock('@/lib/documents/stuck-processing', () => ({ failDocumentsOfDeadJob: queue.failDocumentsOfDeadJob }))

const { runBffJobTask } = await import('./task-run')
const { UnknownJobKindError } = await import('./run')

const ENV = { BFF_JOBS_MAX_ATTEMPTS: '2' }
const input = { job_id: 'job-1', kind: 'office_rendition', organization_id: 'org-1', priority: 'interactive' as const, generation: 0 }
const run = () => runBffJobTask(input, { run: 'run-1', retryCount: 0, workerId: 'w-1' }, { trigger: vi.fn() }, ENV)

beforeEach(() => {
  vi.clearAllMocks()
  queue.attempts = 1
  queue.slice.mockRejectedValue(new Error('converter down'))
  queue.killJob.mockResolvedValue(undefined)
  queue.failDocumentsOfDeadJob.mockResolvedValue({ checked: 1, requeued: 0, failed: 1, gone: 0, errors: 0 })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('the documents of a job that goes dead', () => {
  it('are failed in the run whose last attempt failed, after the row says dead', async () => {
    queue.attempts = 2
    queue.failJob.mockResolvedValue('dead')

    await expect(run()).rejects.toMatchObject({ name: 'PermanentJobError', message: 'dead: Error' })

    expect(queue.failDocumentsOfDeadJob).toHaveBeenCalledExactlyOnceWith('job-1')
    expect(queue.failJob.mock.invocationCallOrder[0]).toBeLessThan(queue.failDocumentsOfDeadJob.mock.invocationCallOrder[0])
  })

  it('are left alone while the job has attempts left, and when another run holds the row', async () => {
    queue.failJob.mockResolvedValue('queued')
    await expect(run()).rejects.toMatchObject({ name: 'RetryLaterError' })

    queue.failJob.mockResolvedValue(null)
    await expect(run()).resolves.toEqual({ job_id: 'job-1', outcome: 'skipped' })

    expect(queue.failDocumentsOfDeadJob).not.toHaveBeenCalled()
  })

  it('are failed for a run lost on its last attempt and for a kind nobody knows, which never reach a handler', async () => {
    queue.attempts = 3
    await expect(run()).resolves.toEqual({ job_id: 'job-1', outcome: 'skipped' })
    expect(queue.slice).not.toHaveBeenCalled()
    expect(queue.failDocumentsOfDeadJob).toHaveBeenCalledTimes(1)

    queue.attempts = 1
    queue.slice.mockRejectedValue(new UnknownJobKindError('make_coffee'))
    await expect(run()).rejects.toMatchObject({ name: 'PermanentJobError' })
    expect(queue.failDocumentsOfDeadJob).toHaveBeenCalledTimes(2)
    expect(queue.killJob.mock.invocationCallOrder[1]).toBeLessThan(queue.failDocumentsOfDeadJob.mock.invocationCallOrder[1])
  })

  it('never change the job’s outcome: a write that throws is logged and left to the sweep', async () => {
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {})
    queue.attempts = 2
    queue.failJob.mockResolvedValue('dead')
    queue.failDocumentsOfDeadJob.mockRejectedValue(new Error('database gone'))

    await expect(run()).rejects.toMatchObject({ name: 'PermanentJobError', message: 'dead: Error' })

    expect(warned).toHaveBeenCalledWith(expect.stringContaining('the sweep will'), expect.any(Error))
  })
})
