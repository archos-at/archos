/**
 * @vitest-environment node
 *
 * The one piece of wiring a real engine cannot show cheaply: which SDK error
 * each of our failures becomes, through a fake client at the one seam
 * (`useHatchetForTests`). Everything the task does on an engine is
 * `hatchet.integration.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NonRetryableError, RetryAfterError } from '@hatchet-dev/typescript-sdk/v1'
import { PermanentJobError, RetryLaterError, type BffJobTaskInput } from './hatchet-task'
import { startBffJobWorker, triggerBffJob, useHatchetForTests, type BffJobTaskOptions, type HatchetLike } from './hatchet'

const INPUT: BffJobTaskInput = { job_id: 'job-1', kind: 'inbox_push', organization_id: 'org-1', priority: 'interactive', generation: 0 }

function fakeHatchet() {
  const declaration = { runNoWait: vi.fn().mockResolvedValue({}), schedule: vi.fn().mockResolvedValue({}) }
  const worker = { start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }
  const tasks: BffJobTaskOptions[] = []
  const client: HatchetLike = {
    task: (options) => {
      tasks.push(options)
      return declaration
    },
    worker: vi.fn().mockResolvedValue(worker),
  }
  return { client, declaration, worker, tasks }
}

let hatchet: ReturnType<typeof fakeHatchet>
const work = { run: vi.fn(), sweep: vi.fn() }

beforeEach(() => {
  hatchet = fakeHatchet()
  useHatchetForTests(hatchet.client)
  work.run.mockReset()
  work.sweep.mockReset()
  work.sweep.mockResolvedValue({ dispatched: 0, failed: 0, purged: 0 })
})

afterEach(() => {
  useHatchetForTests(null)
  vi.unstubAllEnvs()
})

/** The task as the worker registered it. */
const registered = async () => {
  const started = await startBffJobWorker('bff-jobs-pod-1', work)
  await started.stop()
  return hatchet.tasks[0]
}
const ctx = (retryCount = 0) => ({ taskRunExternalId: () => 'run-1', retryCount: () => retryCount })

describe('the bff-job task’s failures, as the SDK reads them', () => {
  it('makes a permanent failure the SDK’s non-retryable error, and a retry-later its retry-after', async () => {
    const { fn } = await registered()

    work.run.mockRejectedValueOnce(new PermanentJobError('no handler'))
    await expect(fn(INPUT, ctx())).rejects.toBeInstanceOf(NonRetryableError)

    work.run.mockRejectedValueOnce(new RetryLaterError('backend 503', 60))
    const later = await fn(INPUT, ctx()).catch((error: unknown) => error)
    expect(later).toBeInstanceOf(RetryAfterError)
    expect((later as RetryAfterError).afterMs).toBe(60_000)

    // No backoff configured: Hatchet retries at once.
    const plain = new RetryLaterError('blip', 0)
    work.run.mockRejectedValueOnce(plain)
    await expect(fn(INPUT, ctx())).rejects.toBe(plain)
  })

  it('refuses to run in a process that only enqueues', async () => {
    await triggerBffJob(INPUT)

    await expect(hatchet.tasks[0].fn(INPUT, ctx())).rejects.toThrow('does not work jobs')
  })
})
