/**
 * @vitest-environment node
 *
 * The one wiring spec with a fake client: what the `bff-jobs` worker registers.
 * What the engine does with it (a scheduled fire, replacing a run, a cron that
 * does not overlap itself) is `hatchet.integration.spec.ts`, against a real one.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConcurrencyLimitStrategy } from '@hatchet-dev/typescript-sdk/v1'
import { setSchedulingHatchetForTests, type SchedulingHatchet } from './hatchet'

vi.mock('server-only', () => ({}))

afterEach(() => setSchedulingHatchetForTests(null))

describe('the scheduling tasks', () => {
  it('registers the fire, fair per office, and every sweep on its cron with one run at a time', async () => {
    const declared: Array<Record<string, unknown>> = []
    const fake = { task: (options: Record<string, unknown>) => (declared.push(options), options), scheduled: {} }
    setSchedulingHatchetForTests(fake as unknown as SchedulingHatchet)
    const { schedulingTasks } = await import('./tasks')

    await schedulingTasks()

    const byName = new Map(declared.map((options) => [options.name, options]))
    expect(byName.get('fire-task-definition')).toMatchObject({
      retries: 0,
      concurrency: { expression: 'input.organization_id', limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN },
    })
    expect(byName.get('fire-task-definition')).not.toHaveProperty('on')

    const sweeps = declared.filter((options) => options.name !== 'fire-task-definition')
    expect(Object.fromEntries(sweeps.map((options) => [options.name, (options.on as { cron: string }).cron]))).toEqual({
      'runs-reconcile': '* * * * *',
      'reconcile-background-work': '* * * * *',
      'upload-sweep': '* * * * *',
      'folder-placement-sweep': '* * * * *',
      'conversation-trace-erasure': '* * * * *',
      'schedule-repair': '*/5 * * * *',
      'task-runs-prune': '41 * * * *',
      'usage-export': '*/10 * * * *',
      'trace-retention': '17 2 * * *',
      'download-log-retention': '37 2 * * *',
      'frist-reminder': '45 * * * *',
    })
    for (const sweep of sweeps) {
      expect(sweep.concurrency).toEqual({
        expression: `'${String(sweep.name)}'`,
        maxRuns: 1,
        limitStrategy: ConcurrencyLimitStrategy.CANCEL_NEWEST,
      })
    }
  })
})
