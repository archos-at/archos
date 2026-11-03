/**
 * @vitest-environment node
 *
 * What a stopping `bff-jobs` pod gives back: the rows of the attempts still
 * running in this process, in one call, each with its own holder, and nothing
 * twice. The UPDATE itself, and that the next run takes a given-back row at
 * once, is `hatchet-run.integration.spec.ts` against Postgres.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/tenant-context', () => ({
  runWithTenantSlot: <T,>(fn: () => Promise<T>) => fn(),
  withPlatformAccess: <T,>(_why: string, fn: () => Promise<T>) => fn(),
}))
const releaseJobs = vi.fn<(held: ReadonlyArray<{ jobId: string; holder: string }>) => Promise<number>>()
vi.mock('./repository', () => ({
  takeJob: async (jobId: string, holder: string) => ({ jobId, claimedBy: holder, kind: 'inbox_push', lane: 'org-1', payload: {}, attempts: 1 }),
  finishJob: async () => true,
  heartbeatJob: async () => true,
  releaseJobs: (held: ReadonlyArray<{ jobId: string; holder: string }>) => releaseJobs(held),
}))
const slice = vi.hoisted(() => ({ finish: null as null | (() => void) }))
vi.mock('./run', () => ({
  UnknownJobKindError: class extends Error {},
  runHandler: () =>
    new Promise((resolve) => {
      slice.finish = () => resolve({ done: true, payload: {} })
    }),
}))

const { releaseInFlightJobs, runBffJobTask } = await import('./hatchet-run')

const input = { job_id: 'job-1', kind: 'inbox_push', organization_id: 'org-1', priority: 'interactive' as const, generation: 0 }
const runs = { trigger: vi.fn() }
const startSlice = async () => {
  slice.finish = null
  const run = runBffJobTask(input, { run: 'run-1', retryCount: 0, workerId: 'w-1' }, runs, {})
  await vi.waitFor(() => expect(slice.finish).not.toBeNull())
  return { run }
}

afterEach(() => {
  releaseJobs.mockReset()
  vi.restoreAllMocks()
})

describe('giving back the rows of a stopping pod', () => {
  it('releases each row still running under its own holder, once, and nothing when none runs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    releaseJobs.mockResolvedValue(1)
    const { run } = await startSlice()

    expect(await releaseInFlightJobs()).toBe(1)
    expect(releaseJobs).toHaveBeenCalledWith([{ jobId: 'job-1', holder: 'run-1/0@w-1' }])
    // A second stop step, or a stop with nothing running, sends nothing.
    expect(await releaseInFlightJobs()).toBe(0)
    expect(releaseJobs).toHaveBeenCalledTimes(1)

    slice.finish?.()
    await run
  })

  it('logs a release that fails and leaves the row to the stale window, never throwing', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    releaseJobs.mockRejectedValue(new Error('database gone'))
    const { run } = await startSlice()

    await expect(releaseInFlightJobs()).resolves.toBe(0)
    expect(logged).toHaveBeenCalledTimes(1)

    slice.finish?.()
    await run
    // The slice ended: its row is no longer this process's to give back.
    releaseJobs.mockResolvedValue(0)
    expect(await releaseInFlightJobs()).toBe(0)
    expect(releaseJobs).toHaveBeenCalledTimes(1)
  })
})
