/**
 * @vitest-environment node
 */
/**
 * The platform kill switch: the job store first, then every run its reports did
 * not close, through the one recorder, and nothing at all when the job store
 * did not confirm the kill.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/tasks/run-moves', () => ({ claimRunsToInterrupt: vi.fn() }))
vi.mock('@/lib/tasks/service', () => ({ recordRunOutcome: vi.fn() }))
vi.mock('@/lib/jobs/backend-client', () => ({ killActiveBackendJobs: vi.fn() }))
vi.mock('./reconcile', () => ({
  reconcileRunWithEnding: vi.fn(),
  readReconcileConfig: () => ({ staleMinutes: 10, unknownGraceMinutes: 120, batch: 25 }),
}))
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: vi.fn(async (_scope: unknown, run: () => Promise<unknown>) => run()),
  withPlatformAccess: vi.fn(async (_why: string, run: () => Promise<unknown>) => run()),
}))

import type { TaskRun } from '@/lib/db/schema/task-model'
import { withTenant } from '@/lib/db/tenant-context'
import { killActiveBackendJobs, type BackendKillResult } from '@/lib/jobs/backend-client'
import { claimRunsToInterrupt } from '@/lib/tasks/run-moves'
import { recordRunOutcome } from '@/lib/tasks/service'
import { KILL_RUN_BATCH, KILLED_REASON, killAllActiveRuns } from './kill-all'
import { reconcileRunWithEnding } from './reconcile'

/** A run with no backend job id unless one is given: nothing can be running for it. */
const run = (id: string, organizationId = 'org_1', backendJobId: string | null = null) =>
  ({ id, organizationId, backendJobId }) as TaskRun

function backend(overrides: Partial<BackendKillResult> = {}): BackendKillResult {
  return { found: 2, killed: ['job-1', 'job-2'], alreadyFinished: 0, failed: [], truncated: false, ...overrides }
}

beforeEach(() => {
  vi.mocked(killActiveBackendJobs).mockReset().mockResolvedValue(backend())
  vi.mocked(claimRunsToInterrupt).mockReset().mockResolvedValue([])
  vi.mocked(recordRunOutcome).mockReset().mockResolvedValue({ notified: true, filed: null, closed: true })
  vi.mocked(reconcileRunWithEnding).mockReset().mockResolvedValue({ verdict: 'waiting' })
  vi.mocked(withTenant).mockClear()
})

describe('killAllActiveRuns', () => {
  it('kills the jobs, then closes every still-active run as interrupted inside its own organization', async () => {
    vi.mocked(claimRunsToInterrupt).mockResolvedValue([run('run-a', 'org_1'), run('run-b', 'org_2')])

    const result = await killAllActiveRuns()

    // The kill switch's own claim, which leaves out a run whose block reads
    // `done` (`reconcile.integration.spec.ts` holds the SQL), never the reconciler's.
    expect(claimRunsToInterrupt).toHaveBeenCalledTimes(1)
    expect(claimRunsToInterrupt).toHaveBeenCalledWith(KILL_RUN_BATCH)
    for (const [id, organizationId] of [['run-a', 'org_1'], ['run-b', 'org_2']] as const) {
      expect(recordRunOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ id }),
        { status: 'interrupted', error: KILLED_REASON },
        { onlyIfActive: true },
      )
      expect(withTenant).toHaveBeenCalledWith({ organizationId }, expect.any(Function))
    }
    expect(result).toEqual({
      jobsFound: 2,
      jobsKilled: 2,
      jobsAlreadyFinished: 0,
      runsClosed: 2,
      runsSucceeded: 0,
      runsFailed: 0,
      runsWaiting: 0,
      failures: [],
      truncated: false,
    })
  })

  describe('a run whose job the kill did not stop', () => {
    it('is closed by the job store’s verdict, not as interrupted: one that had already succeeded ends succeeded', async () => {
      // The worker owned SUCCESS in the job store and its outcome report was
      // still on its way. The backend counts that job as already finished.
      vi.mocked(killActiveBackendJobs).mockResolvedValue(backend({ found: 3, alreadyFinished: 1 }))
      const finished = run('run-finished', 'org_2', 'job-3')
      vi.mocked(claimRunsToInterrupt).mockResolvedValue([run('run-killed', 'org_1', 'job-1'), finished])
      vi.mocked(reconcileRunWithEnding).mockResolvedValue({ verdict: 'closed', ending: 'success' })

      const result = await killAllActiveRuns()

      expect(recordRunOutcome).toHaveBeenCalledTimes(1)
      expect(recordRunOutcome).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'run-killed' }),
        { status: 'interrupted', error: KILLED_REASON },
        { onlyIfActive: true },
      )
      expect(reconcileRunWithEnding).toHaveBeenCalledTimes(1)
      expect(vi.mocked(reconcileRunWithEnding).mock.calls[0][0]).toBe(finished)
      expect(withTenant).toHaveBeenCalledWith({ organizationId: 'org_2' }, expect.any(Function))
      // Counted as what it is.
      expect(result).toMatchObject({ runsClosed: 1, runsSucceeded: 1, runsFailed: 0, runsWaiting: 0 })
    })

    it('counts each ending the store gave, and what stays live for the reconciler', async () => {
      vi.mocked(killActiveBackendJobs).mockResolvedValue(
        backend({ killed: [], failed: [{ jobId: 'job-stuck', error: 'worker unreachable' }] }),
      )
      vi.mocked(claimRunsToInterrupt).mockResolvedValue(
        ['job-a', 'job-b', 'job-stuck', 'job-d', 'job-e'].map((job) => run(`run-${job}`, 'org_1', job)),
      )
      vi.mocked(reconcileRunWithEnding)
        .mockResolvedValueOnce({ verdict: 'closed', ending: 'failure' })
        // INTERRUPTED was written in an earlier press and its report was lost.
        .mockResolvedValueOnce({ verdict: 'closed', ending: 'interrupted' })
        // Its kill failed: the job still runs, and its row keeps saying so.
        .mockResolvedValueOnce({ verdict: 'waiting' })
        .mockResolvedValueOnce({ verdict: 'already-closed' })
        .mockResolvedValueOnce({ verdict: 'closed', ending: 'success' })

      const result = await killAllActiveRuns()

      expect(recordRunOutcome).not.toHaveBeenCalled()
      expect(result).toMatchObject({ runsClosed: 1, runsSucceeded: 1, runsFailed: 1, runsWaiting: 1 })
      expect(result.failures).toEqual([{ id: 'job-stuck', error: 'worker unreachable' }])
    })

    it('closes a run with no job id as interrupted without asking the store: nothing can be running for it', async () => {
      vi.mocked(claimRunsToInterrupt).mockResolvedValue([run('run-unsubmitted')])

      expect((await killAllActiveRuns()).runsClosed).toBe(1)
      expect(reconcileRunWithEnding).not.toHaveBeenCalled()
    })
  })

  it('does not count a run the backend report already closed', async () => {
    vi.mocked(claimRunsToInterrupt).mockResolvedValue([run('run-a')])
    vi.mocked(recordRunOutcome).mockResolvedValue({ notified: false, filed: null, closed: false })

    expect((await killAllActiveRuns()).runsClosed).toBe(0)
  })

  it('closes no run when the job store did not confirm the kill', async () => {
    vi.mocked(killActiveBackendJobs).mockRejectedValue(new Error('backend down'))

    await expect(killAllActiveRuns()).rejects.toThrow('backend down')
    expect(claimRunsToInterrupt).not.toHaveBeenCalled()
    expect(recordRunOutcome).not.toHaveBeenCalled()
  })

  it('names what could not be stopped, and keeps going past it', async () => {
    vi.mocked(killActiveBackendJobs).mockResolvedValue(
      backend({ killed: ['job-1'], failed: [{ jobId: 'job-2', error: 'worker unreachable' }] }),
    )
    vi.mocked(claimRunsToInterrupt).mockResolvedValue([run('run-a'), run('run-b')])
    vi.mocked(recordRunOutcome)
      .mockRejectedValueOnce(new Error('db blip'))
      .mockResolvedValueOnce({ notified: true, filed: null, closed: true })

    const result = await killAllActiveRuns()

    expect(result.runsClosed).toBe(1)
    expect(result.failures).toEqual([
      { id: 'job-2', error: 'worker unreachable' },
      { id: 'run-a', error: 'db blip' },
    ])
  })

  it('says so when either half hit its bound', async () => {
    vi.mocked(killActiveBackendJobs).mockResolvedValue(backend({ truncated: true }))
    expect((await killAllActiveRuns()).truncated).toBe(true)

    vi.mocked(killActiveBackendJobs).mockResolvedValue(backend())
    vi.mocked(claimRunsToInterrupt).mockResolvedValue(
      Array.from({ length: KILL_RUN_BATCH }, (_, i) => run(`run-${i}`)),
    )
    expect((await killAllActiveRuns()).truncated).toBe(true)
  })
})
