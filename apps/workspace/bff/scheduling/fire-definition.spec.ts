/**
 * @vitest-environment node
 *
 * The schedule repair after a cutover: every definition the scan returns gets
 * its scheduled run, inside its own organization, in batches large enough that
 * an installation's schedules are covered in a run or two. The scan's SQL is
 * `repository.integration.spec.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TaskDefinition } from '@/lib/db/schema/task-model'

vi.mock('server-only', () => ({}))

const findDefinitionsToRepair = vi.fn<(grace: number, limit: number) => Promise<TaskDefinition[]>>()
vi.mock('./repository', () => ({
  findDefinitionsToRepair: (grace: number, limit: number) => findDefinitionsToRepair(grace, limit),
  advanceDueDefinition: vi.fn(),
}))
const syncScheduledRun = vi.fn(async (_definition: TaskDefinition, _now: Date) => undefined)
vi.mock('./scheduled-runs', () => ({ syncScheduledRun: (definition: TaskDefinition, now: Date) => syncScheduledRun(definition, now) }))
vi.mock('@/lib/jobs/service', () => ({ fireScheduledJob: vi.fn() }))
const tenants: string[] = []
vi.mock('@/lib/db/tenant-context', () => ({
  withTenant: async <T,>(tenant: { organizationId: string }, fn: () => Promise<T>) => {
    tenants.push(tenant.organizationId)
    return fn()
  },
}))
vi.mock('./log', () => ({ report: vi.fn() }))

const definition = (id: string, organizationId: string) => ({ id, organizationId, enabled: true, nextRunAt: new Date(), scheduledRunId: null }) as unknown as TaskDefinition

beforeEach(() => {
  findDefinitionsToRepair.mockReset()
  syncScheduledRun.mockClear()
  tenants.length = 0
})

describe('the schedule repair', () => {
  it('schedules every definition the scan finds, each inside its own organization', async () => {
    const { repairSchedules } = await import('./fire-definition')
    findDefinitionsToRepair.mockResolvedValueOnce([definition('d-1', 'org-a'), definition('d-2', 'org-b')])
    const now = new Date('2026-11-03T08:00:00Z')

    expect(await repairSchedules(now)).toBe(2)

    expect(syncScheduledRun.mock.calls.map(([d, at]) => [d.id, at])).toEqual([
      ['d-1', now],
      ['d-2', now],
    ])
    expect(tenants).toEqual(['org-a', 'org-b'])
  })

  it('scans with the grace for overdue rows and a batch that drains a cutover in a run or two', async () => {
    const { repairSchedules, REPAIR_GRACE_MINUTES, REPAIR_BATCH } = await import('./fire-definition')
    findDefinitionsToRepair.mockResolvedValueOnce([])

    expect(await repairSchedules()).toBe(0)

    expect(findDefinitionsToRepair).toHaveBeenCalledWith(REPAIR_GRACE_MINUTES, REPAIR_BATCH)
    expect(REPAIR_BATCH).toBeGreaterThanOrEqual(500)
    expect(syncScheduledRun).not.toHaveBeenCalled()
  })
})
