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
  vi.restoreAllMocks()
})

/** The task as the worker registered it. */
const registered = async () => {
  const started = await startBffJobWorker('bff-jobs-pod-1', work)
  await started.stop()
  return hatchet.tasks[0]
}
const ctx = (retryCount = 0) => ({
  taskRunExternalId: () => 'run-1',
  retryCount: () => retryCount,
  abortController: new AbortController(),
  worker: { id: () => 'worker-1' },
})

describe('the bff-job task’s failures, as the SDK reads them', () => {
  it('makes a permanent failure the SDK’s non-retryable error, and a retry-later its retry-after', async () => {
    const { fn } = await registered()

    work.run.mockRejectedValueOnce(new PermanentJobError('unknown-kind'))
    await expect(fn(INPUT, ctx())).rejects.toBeInstanceOf(NonRetryableError)

    work.run.mockRejectedValueOnce(new RetryLaterError('attempt-failed', 60))
    const later = await fn(INPUT, ctx()).catch((error: unknown) => error)
    expect(later).toBeInstanceOf(RetryAfterError)
    expect((later as RetryAfterError).afterMs).toBe(60_000)

    // No backoff configured: Hatchet retries at once.
    work.run.mockRejectedValueOnce(new RetryLaterError('attempt-failed', 0))
    const plain = await fn(INPUT, ctx()).catch((error: unknown) => error)
    expect(plain).not.toBeInstanceOf(RetryAfterError)
    expect((plain as Error).message).toBe('attempt-failed')
  })

  it('tells Hatchet the category and the error class, never the message, and logs the whole error on the pod', async () => {
    const { fn } = await registered()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const secret = 'Bauantrag Seestadt D12.pdf at https://files.example/k/plan.pdf'
    class StorageError extends Error {
      override name = 'StorageError'
    }

    const sent: Error[] = []
    for (const thrown of [
      new PermanentJobError('dead', new StorageError(secret)),
      new RetryLaterError('attempt-failed', 30, new TypeError(secret)),
      new StorageError(secret),
      secret,
    ]) {
      work.run.mockRejectedValueOnce(thrown)
      sent.push((await fn(INPUT, ctx()).catch((error: unknown) => error)) as Error)
    }

    expect(sent.map((error) => error.message)).toEqual(['dead: StorageError', 'attempt-failed: TypeError', 'run-failed: StorageError', 'run-failed: string'])
    for (const error of sent) expect(`${error.message}\n${error.stack}`).not.toContain('Seestadt')
    expect(logged.mock.calls.flat().map(String).join(' ')).toContain(secret)
  })

  it('hands the run its attempt, its worker and the signal Hatchet aborts it with', async () => {
    const { fn } = await registered()
    work.run.mockResolvedValueOnce({ job_id: 'job-1', outcome: 'done' })
    const context = ctx(2)

    await fn(INPUT, context)

    expect(work.run.mock.calls[0][1]).toEqual({ run: 'run-1', retryCount: 2, workerId: 'worker-1', signal: context.abortController.signal })
  })

  it('refuses to run in a process that only enqueues', async () => {
    await triggerBffJob(INPUT)
    vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(hatchet.tasks[0].fn(INPUT, ctx())).rejects.toThrow('run-failed: Error')
  })
})
