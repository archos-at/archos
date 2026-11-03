/**
 * @vitest-environment node
 *
 * The one wiring spec with a fake client: what the `bff-jobs` worker registers.
 * What the engine does with it (a scheduled fire, replacing a run, a cron that
 * does not overlap itself) is `orchestrator.integration.spec.ts`, against a real one.
 */
import { describe, expect, it, vi } from 'vitest'
import { ConcurrencyLimitStrategy } from '@hatchet-dev/typescript-sdk/v1'
import type { TaskDeclarer } from './tasks'

vi.mock('server-only', () => ({}))

describe('the scheduling tasks', () => {
  it('registers the fire, fair per office, and every sweep on its cron with one run at a time', async () => {
    const declared: Array<Record<string, unknown>> = []
    const fake = { task: (options: Record<string, unknown>) => (declared.push(options), options) }
    const { schedulingTasks } = await import('./tasks')

    schedulingTasks(fake as unknown as TaskDeclarer)

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
      'inbound-mail-sweep': '* * * * *',
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

  it('tells Hatchet only the category and the class of a failure, and logs the whole error on the pod', async () => {
    const { reportingOnlyTheClass } = await import('./tasks')
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secret = 'Bauantrag Seestadt D12.pdf at https://files.example/k/plan.pdf'

    const sent = (await reportingOnlyTheClass('upload-sweep', 'sweep-failed', async () => {
      throw new TypeError(secret)
    }).catch((error: unknown) => error)) as Error

    expect(sent.message).toBe('sweep-failed: TypeError')
    expect(`${sent.message}\n${sent.stack}`).not.toContain('Seestadt')
    expect(logged.mock.calls.flat().map(String).join(' ')).toContain(secret)
    expect(await reportingOnlyTheClass('upload-sweep', 'sweep-failed', async () => 7)).toBe(7)
    logged.mockRestore()
  })
})
