/**
 * @vitest-environment node
 *
 * The index jobs go into the platform organization's lane, whatever scope the caller has: the queue's RLS stores a
 * job only in the active tenant's lane, and the carry Job has no tenant at all (prod's first carry failed all 54).
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getTenantContext } from '@/lib/db/tenant-context'

vi.mock('server-only', () => ({}))

const seen: unknown[] = []
const enqueueJob = vi.fn(async () => {
  seen.push(getTenantContext())
  return { jobId: 'job' }
})
const update = vi.fn()
vi.mock('@/lib/jobs-queue/enqueue', () => ({ enqueueJob: (...args: unknown[]) => enqueueJob(...(args as [])) }))
vi.mock('@/lib/db', () => ({
  getDb: () => ({ update: () => ({ set: (values: unknown) => ({ where: async () => update(values) }) }) }),
}))
vi.mock('@/lib/knowledge/service', () => ({}))

const { enqueueIndexRuns } = await import('./indexing')

describe('enqueueIndexRuns', () => {
  beforeEach(() => {
    seen.length = 0
    enqueueJob.mockClear()
    update.mockClear()
  })

  it("enqueues in the platform organization's tenant scope when the caller has none", async () => {
    await expect(enqueueIndexRuns('org_platform', ['run-1', 'run-2'])).resolves.toEqual({ enqueued: 2, failed: 0 })
    expect(seen).toEqual([
      { kind: 'tenant', organizationId: 'org_platform', userId: null },
      { kind: 'tenant', organizationId: 'org_platform', userId: null },
    ])
  })

  it("marks the run failed with the database's reason, not only the wrapper's", async () => {
    enqueueJob.mockRejectedValueOnce(new Error('Failed query: insert into bff_job_queue', { cause: new Error('new row violates row-level security policy') }))
    await expect(enqueueIndexRuns('org_platform', ['run-1'])).resolves.toEqual({ enqueued: 0, failed: 1 })
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      state: 'failed',
      failure: 'the indexing job was not enqueued: Failed query: insert into bff_job_queue (new row violates row-level security policy)',
    }))
  })
})
