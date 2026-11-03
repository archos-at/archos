/**
 * The thin layer between the BFF's jobs and the Hatchet SDK (ADR-0150): the only
 * module under `jobs-queue/` that imports `@hatchet-dev/typescript-sdk`.
 *
 * It declares the `bff-job` task from `./hatchet-task.ts`'s spec, triggers it
 * for an enqueue (`./enqueue.ts`), and starts the worker and the dispatch sweep
 * in the `bff-jobs` pod (`./slice-entry.ts`), which hands it what a run does
 * (`./hatchet-run.ts`): the enqueue side, which every service imports, then
 * never imports the handlers, which import those services. The handlers never see the SDK;
 * the task throws our own errors, and this file says what Hatchet makes of them:
 * {@link PermanentJobError} is the SDK's `NonRetryableError`, {@link RetryLaterError}
 * its `RetryAfterError` (engine v0.111.0 or later; an older one retries at once).
 *
 * The connection is the SDK's own configuration from its standard environment
 * (`HATCHET_CLIENT_TOKEN`, `HATCHET_CLIENT_HOST_PORT`,
 * `HATCHET_CLIENT_TLS_STRATEGY`, `HATCHET_CLIENT_NAMESPACE`); nothing here
 * reads or re-implements it.
 */

import 'server-only'
import {
  ConcurrencyLimitStrategy,
  HatchetClient,
  IdempotencyCollisionError,
  NonRetryableError,
  Priority,
  RetryAfterError,
  type TaskWorkflowDeclaration,
} from '@hatchet-dev/typescript-sdk/v1'
import {
  bffJobTaskSpec,
  PermanentJobError,
  RetryLaterError,
  RUN_PRIORITY,
  type BffJobRuns,
  type BffJobTaskInput,
  type BffJobTaskOutput,
  type BffJobTaskSpec,
} from './hatchet-task'

export type RunOptions = { priority: Priority; additionalMetadata: Record<string, string> }

/** What this module asks of a task declaration (the SDK's `TaskWorkflowDeclaration`). */
export interface BffJobDeclaration {
  runNoWait(input: BffJobTaskInput, options: RunOptions): Promise<unknown>
  schedule(enqueueAt: Date, input: BffJobTaskInput, options: RunOptions): Promise<unknown>
}

/** The run's context, as much of the SDK's `Context` as the task reads. */
export interface BffJobContext {
  taskRunExternalId(): string
  retryCount(): number
}

/** What this module passes to `hatchet.task(...)`. */
export interface BffJobTaskOptions {
  name: string
  retries: number
  executionTimeout: number
  scheduleTimeout: BffJobTaskSpec['scheduleTimeout']
  concurrency: { expression: string; maxRuns: number; limitStrategy: ConcurrencyLimitStrategy }
  idempotency: BffJobTaskSpec['idempotency']
  fn: (input: BffJobTaskInput, ctx: BffJobContext) => Promise<BffJobTaskOutput>
}

/** What a run does and what the sweep does (`./hatchet-run.ts`), handed in by the pod that works. */
export interface BffJobWork {
  run(input: BffJobTaskInput, context: { run: string; retryCount: number }, runs: BffJobRuns): Promise<BffJobTaskOutput>
  sweep(runs: BffJobRuns): Promise<{ dispatched: number; failed: number; purged: number }>
}

export interface BffJobWorker {
  start(): Promise<void>
  stop(): Promise<void>
}

/** The slice of the SDK client this module uses; specs hand in a fake here, and only here. */
export interface HatchetLike<D extends BffJobDeclaration = BffJobDeclaration> {
  task(options: BffJobTaskOptions): D
  worker(name: string, options: { slots: number; handleKill: false; workflows: D[] }): Promise<BffJobWorker>
}

function sdkClient(): HatchetLike<TaskWorkflowDeclaration<BffJobTaskInput, BffJobTaskOutput>> {
  const hatchet = HatchetClient.init()
  return {
    task: (options) => hatchet.task<BffJobTaskInput, BffJobTaskOutput>(options),
    worker: (name, options) => hatchet.worker(name, options),
  }
}

const SDK_PRIORITY: Record<1 | 3, Priority> = { 1: Priority.LOW, 3: Priority.HIGH }

/** Start a run, now or at `notBefore`; a run that already holds this job's key is the run asked for. */
function runsOf(declaration: BffJobDeclaration, now: () => number): BffJobRuns {
  return {
    async trigger(input, { notBefore }) {
      const options: RunOptions = {
        priority: SDK_PRIORITY[RUN_PRIORITY[input.priority]],
        additionalMetadata: { job_id: input.job_id, kind: input.kind, organization_id: input.organization_id },
      }
      try {
        if (notBefore && notBefore.getTime() > now()) await declaration.schedule(notBefore, input, options)
        else await declaration.runNoWait(input, options)
      } catch (error) {
        if (error instanceof IdempotencyCollisionError) return
        throw error
      }
    },
  }
}

/** The task's options from its spec, with the SDK's errors around the run. */
export function bffJobTaskOptions(spec: BffJobTaskSpec, runs: () => BffJobRuns, work: () => BffJobWork): BffJobTaskOptions {
  return {
    name: spec.name,
    retries: spec.retries,
    executionTimeout: spec.executionTimeoutMs,
    scheduleTimeout: spec.scheduleTimeout,
    concurrency: {
      expression: spec.concurrency.expression,
      maxRuns: spec.concurrency.maxRuns,
      limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
    },
    idempotency: spec.idempotency,
    fn: async (input, ctx) => {
      try {
        return await work().run(input, { run: ctx.taskRunExternalId(), retryCount: ctx.retryCount() }, runs())
      } catch (error) {
        if (error instanceof PermanentJobError) throw new NonRetryableError(error.message)
        if (error instanceof RetryLaterError && error.afterSeconds > 0) {
          throw new RetryAfterError(error.message, { after: `${error.afterSeconds}s` })
        }
        throw error
      }
    },
  }
}

interface BffJobTask {
  client: HatchetLike
  declaration: BffJobDeclaration
  runs: BffJobRuns
  spec: BffJobTaskSpec
}

let current: BffJobTask | null = null
let fake: HatchetLike | null = null
/** Set by {@link startBffJobWorker}: only a process that works runs the task. */
let installed: BffJobWork | null = null

/** The process's `bff-job` task, declared once on a client built from the SDK's environment. */
function bffJobTask(): BffJobTask {
  if (current) return current
  const spec = bffJobTaskSpec()
  const client = fake ?? sdkClient()
  // A run triggers its next slice through the declaration it is a run of.
  const late: { runs?: BffJobRuns } = {}
  const declaration = client.task(
    bffJobTaskOptions(
      spec,
      () => {
        if (!late.runs) throw new Error('bff-job ran before its declaration returned')
        return late.runs
      },
      () => {
        if (!installed) throw new Error('bff-job ran in a process that does not work jobs')
        return installed
      }
    )
  )
  late.runs = runsOf(declaration, Date.now)
  current = { client, declaration, runs: late.runs, spec }
  return current
}

/** Replace (or drop) the SDK client. Specs fake Hatchet here, at one place. */
export function useHatchetForTests(client: HatchetLike | null): void {
  fake = client
  current = null
  installed = null
}

/** Start a `bff-job` run for an enqueue and return; nothing waits for it. */
export function triggerBffJob(input: BffJobTaskInput, options: { notBefore?: Date } = {}): Promise<void> {
  return bffJobTask().runs.trigger(input, options)
}

/** How often each `bff-jobs` replica dispatches the rows no run is coming for. */
const SWEEP_EVERY_MS = 60_000

/**
 * Register `bff-job` on a worker, start it, and start the dispatch sweep.
 * `done` settles when the worker stops, or rejects when it could not run;
 * `stop` is the pod's drain. `handleKill: false`: the pod's own SIGTERM handler
 * orders the shutdown (`workers/jobs/index.js`), not the SDK.
 */
export async function startBffJobWorker(
  name: string,
  work: BffJobWork
): Promise<{ done: Promise<void>; stop: () => Promise<void> }> {
  installed = work
  const { client, declaration, runs, spec } = bffJobTask()
  const worker = await client.worker(name, { slots: spec.slots, handleKill: false, workflows: [declaration] })
  const done = worker.start()
  const sweep = async () => {
    try {
      const swept = await work.sweep(runs)
      if (swept.failed) console.warn('[bff-jobs] sweep:', swept)
    } catch (error) {
      console.warn('[bff-jobs] the dispatch sweep failed; the next one tries again:', error)
    }
  }
  void sweep()
  const timer = setInterval(() => void sweep(), SWEEP_EVERY_MS)
  timer.unref?.()
  return {
    done,
    stop: async () => {
      clearInterval(timer)
      await worker.stop()
    },
  }
}
