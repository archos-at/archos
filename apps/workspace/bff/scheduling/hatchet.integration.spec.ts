/**
 * @vitest-environment node
 *
 * Scheduling against a REAL Hatchet engine (hatchet-lite in CI), the main
 * evidence that the layer works (ADR-0150):
 *
 *   - a definition's scheduled run fires `fire-task-definition` on a worker,
 *     and the fire schedules the next one;
 *   - a change to the definition replaces its scheduled run, and deleting it
 *     deletes the run;
 *   - a sweep runs once and does not overlap itself.
 *
 *   HATCHET_CLIENT_TOKEN=… HATCHET_CLIENT_HOST_PORT=localhost:7077 HATCHET_CLIENT_TLS_STRATEGY=none \
 *     npx vitest run bff/scheduling/hatchet.integration.spec.ts
 *
 * The engine is real; our own database is not. What the database does with a
 * fire (taking the occurrence once, however many fires race for it) is
 * `repository.integration.spec.ts` against Postgres, and what the run does is
 * `fireScheduledJob`'s own spec. Both are stubbed here at their module.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { HatchetClient, Worker } from '@hatchet-dev/typescript-sdk/v1'
import type { TaskDefinition } from '@/lib/db/schema/task-model'

vi.mock('server-only', () => ({}))

const setScheduledRunId = vi.fn(async (_id: string, _org: string, _run: string | null) => undefined)
const advanceDueDefinition = vi.fn()
vi.mock('./repository', () => ({
  setScheduledRunId: (id: string, org: string, run: string | null) => setScheduledRunId(id, org, run),
  advanceDueDefinition: (...args: unknown[]) => advanceDueDefinition(...args),
  findOverdueDefinitions: vi.fn(async () => []),
}))
const fireScheduledJob = vi.fn(async (_definition: TaskDefinition) => ({ fired: true }))
vi.mock('@/lib/jobs/service', () => ({ fireScheduledJob: (definition: TaskDefinition) => fireScheduledJob(definition) }))

const configured = Boolean(process.env.HATCHET_CLIENT_TOKEN && process.env.HATCHET_CLIENT_HOST_PORT)
const STAMP = Date.now()
const ORG = `org_scheduling_${STAMP}`

/** Poll until `check` is true, or fail after `timeoutMs`. */
async function eventually(check: () => boolean | Promise<boolean>, timeoutMs = 60_000): Promise<void> {
  const until = Date.now() + timeoutMs
  while (!(await check())) {
    if (Date.now() > until) throw new Error('timed out waiting')
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

const lastScheduledRunId = (): string | null => setScheduledRunId.mock.calls.at(-1)?.[2] ?? null

describe('the suite is not silently skipped in CI', () => {
  it('has an engine to run against', () => {
    if (!process.env.HATCHET_SUITE_REQUIRED) return
    expect(configured, 'HATCHET_CLIENT_TOKEN or HATCHET_CLIENT_HOST_PORT is unset while HATCHET_SUITE_REQUIRED is set').toBe(true)
  })
})

describe.skipIf(!configured)('scheduling on a real Hatchet engine', () => {
  let hatchet: HatchetClient
  let worker: Worker
  let scheduling: typeof import('./scheduled-runs')
  let overlapping: Awaited<ReturnType<typeof import('./tasks').sweepTask>>
  let sweepRuns = 0

  const gone = async (scheduledRunId: string): Promise<boolean> => {
    try {
      await hatchet.scheduled.get(scheduledRunId)
      return false
    } catch {
      return true
    }
  }

  beforeAll(async () => {
    const { HatchetClient: sdk } = await import('@hatchet-dev/typescript-sdk/v1')
    hatchet = sdk.init()
    const { setSchedulingHatchetForTests } = await import('./hatchet')
    setSchedulingHatchetForTests(hatchet)
    scheduling = await import('./scheduled-runs')
    const { fireTask, sweepTask } = await import('./tasks')
    overlapping = sweepTask(hatchet, {
      name: `overlap-check-${STAMP}`,
      cron: '0 0 1 1 *',
      reason: 'test',
      run: async () => {
        sweepRuns += 1
        await new Promise((resolve) => setTimeout(resolve, 3000))
      },
    })
    worker = await hatchet.worker(`scheduling-spec-${STAMP}`, { workflows: [fireTask(hatchet), overlapping] })
    void worker.start()
    await worker.waitUntilReady(30_000)
  }, 60_000)

  afterAll(async () => {
    await worker?.stop()
  })

  it('replaces the scheduled run when the definition changes, and deletes it with the definition', async () => {
    const first = new Date(Date.now() + 60 * 60_000)
    const definition = { id: `def_replace_${STAMP}`, organizationId: ORG, enabled: true, nextRunAt: first, scheduledRunId: null }

    await scheduling.syncScheduledRun(definition)
    const firstRun = lastScheduledRunId()
    expect(firstRun).toBeTruthy()
    const created = await hatchet.scheduled.get(String(firstRun))
    expect(new Date(created.triggerAt).getTime()).toBe(first.getTime())
    expect(created.input).toMatchObject({ definition_id: definition.id, organization_id: ORG, due_at: first.toISOString() })

    const moved = new Date(first.getTime() + 24 * 60 * 60_000)
    await scheduling.syncScheduledRun({ ...definition, nextRunAt: moved, scheduledRunId: firstRun })
    const secondRun = String(lastScheduledRunId())
    expect(secondRun).not.toBe(firstRun)
    expect(await gone(String(firstRun))).toBe(true)
    expect(new Date((await hatchet.scheduled.get(secondRun)).triggerAt).getTime()).toBe(moved.getTime())

    // Paused: no run at all.
    await scheduling.syncScheduledRun({ ...definition, enabled: false, nextRunAt: moved, scheduledRunId: secondRun })
    expect(lastScheduledRunId()).toBeNull()
    expect(await gone(secondRun)).toBe(true)

    // Deleted.
    await scheduling.syncScheduledRun({ ...definition, scheduledRunId: null })
    const thirdRun = String(lastScheduledRunId())
    await scheduling.dropScheduledRun({ scheduledRunId: thirdRun })
    expect(await gone(thirdRun)).toBe(true)
  })

  it('fires the definition at its due time and schedules the next one', async () => {
    const due = new Date(Date.now() + 2000)
    const next = new Date(Date.now() + 7 * 24 * 60 * 60_000)
    const definition = { id: `def_fire_${STAMP}`, organizationId: ORG, enabled: true, nextRunAt: due, scheduledRunId: null }
    // The occurrence is taken once; every later fire of it finds it moved.
    advanceDueDefinition.mockImplementationOnce(async () => ({
      definition: { ...definition, nextRunAt: next, scheduledRunId: lastScheduledRunId() },
      fire: true,
    }))
    advanceDueDefinition.mockResolvedValue(null)

    await scheduling.syncScheduledRun(definition)
    const fired = String(lastScheduledRunId())
    await eventually(() => fireScheduledJob.mock.calls.length > 0)

    expect(advanceDueDefinition).toHaveBeenCalledWith(definition.id, ORG, due, expect.any(Function))
    expect(fireScheduledJob).toHaveBeenCalledTimes(1)
    await eventually(() => lastScheduledRunId() !== fired)
    const rearmed = await hatchet.scheduled.get(String(lastScheduledRunId()))
    expect(new Date(rearmed.triggerAt).getTime()).toBe(next.getTime())
    await scheduling.dropScheduledRun({ scheduledRunId: String(lastScheduledRunId()) })
  }, 90_000)

  it('runs a sweep once and drops a second run that comes due while the first is going', async () => {
    const first = await overlapping.runNoWait({})
    await eventually(() => sweepRuns === 1, 30_000)
    const second = await overlapping.runNoWait({})

    await first.result()
    await expect(second.result()).rejects.toThrow()
    expect(sweepRuns).toBe(1)
  }, 60_000)
})
