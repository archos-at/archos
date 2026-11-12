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
 *   - a sweep runs once and does not overlap itself;
 *   - a cron with a `CRON_TZ=<zone> ` prefix starts on that zone's clock.
 *
 *   HATCHET_CLIENT_TOKEN=… HATCHET_CLIENT_HOST_PORT=localhost:7077 HATCHET_CLIENT_TLS_STRATEGY=none \
 *     npx vitest run bff/scheduling/orchestrator.integration.spec.ts
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
  findDefinitionsToRepair: vi.fn(async () => []),
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
    hatchet = (await import('@/lib/jobs-queue/orchestrator')).hatchetClient()
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

    const warned = vi.spyOn(console, 'warn')
    await scheduling.syncScheduledRun(definition)
    const fired = String(lastScheduledRunId())
    await eventually(() => fireScheduledJob.mock.calls.length > 0)

    expect(advanceDueDefinition).toHaveBeenCalledWith(definition.id, ORG, due, expect.any(Function))
    expect(fireScheduledJob).toHaveBeenCalledTimes(1)
    await eventually(() => lastScheduledRunId() !== fired)
    const rearmed = await hatchet.scheduled.get(String(lastScheduledRunId()))
    expect(new Date(rearmed.triggerAt).getTime()).toBe(next.getTime())
    // The fire re-arms holding the id of the run that just fired, which the engine no longer has: not worth a line.
    expect(await gone(fired)).toBe(true)
    expect(warned.mock.calls.filter(([line]) => String(line).includes('could not delete scheduled run'))).toEqual([])
    warned.mockRestore()
    await scheduling.dropScheduledRun({ scheduledRunId: String(lastScheduledRunId()) })
  }, 90_000)

  it('starts a cron on the clock of the zone its CRON_TZ prefix names, which is how the Frist reminder stays on 06:45', async () => {
    // The minute after next, written as Tokyo's wall clock (UTC+9, no daylight saving): the same digits read as UTC
    // are nine hours away, so only an engine that honours the prefix runs it now.
    const at = new Date(Math.ceil(Date.now() / 60_000) * 60_000 + 60_000)
    const tokyo = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    const [hour, minute] = tokyo.format(at).split(':').map(Number)
    let zonedRuns = 0
    let plainRuns = 0
    const { sweepTask } = await import('./tasks')
    const spec = { reason: 'test', run: async () => {} }
    const zoned = sweepTask(hatchet, { ...spec, name: `zoned-cron-${STAMP}`, cron: `CRON_TZ=Asia/Tokyo ${minute} ${hour} * * *`, run: async () => void (zonedRuns += 1) })
    const plain = sweepTask(hatchet, { ...spec, name: `plain-cron-${STAMP}`, cron: `${minute} ${hour} * * *`, run: async () => void (plainRuns += 1) })
    const zonedWorker = await hatchet.worker(`zoned-cron-spec-${STAMP}`, { workflows: [zoned, plain] })
    void zonedWorker.start()
    try {
      await zonedWorker.waitUntilReady(30_000)
      await eventually(() => zonedRuns > 0, at.getTime() - Date.now() + 60_000)
      expect(Date.now()).toBeGreaterThanOrEqual(at.getTime())
      expect(plainRuns).toBe(0)
    } finally {
      await zonedWorker.stop()
    }
  }, 240_000)

  it('runs a sweep once and drops a second run that comes due while the first is going', async () => {
    const first = await overlapping.runNoWait({})
    await eventually(() => sweepRuns === 1, 30_000)
    const second = await overlapping.runNoWait({})

    await first.result()
    // A cancelled run's result() resolves (SDK 1.46), so read the run's status.
    await eventually(async () => (await hatchet.runs.get_status(second)) === 'CANCELLED', 30_000)
    expect(sweepRuns).toBe(1)
  }, 60_000)
})
