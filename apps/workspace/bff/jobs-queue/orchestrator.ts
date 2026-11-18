import 'server-only'
import {
  ConcurrencyLimitStrategy,
  type CreateWorkerOpts,
  HatchetClient,
  IdempotencyCollisionError,
  NonRetryableError,
  Priority,
  RetryAfterError,
  type TaskWorkflowDeclaration,
} from '@hatchet-dev/typescript-sdk/v1'
import {
  bffJobTaskSpec,
  failureText,
  PermanentJobError,
  RetryLaterError,
  RUN_PRIORITY,
  type BffJobRunContext,
  type BffJobRuns,
  type BffJobTaskInput,
  type BffJobTaskOutput,
  type BffJobTaskSpec,
} from './task'

export type RunOptions = { priority: Priority; additionalMetadata: Record<string, string> }

export interface BffJobDeclaration {
  runNoWait(input: BffJobTaskInput, options: RunOptions): Promise<unknown>
  schedule(enqueueAt: Date, input: BffJobTaskInput, options: RunOptions): Promise<unknown>
}

export interface BffJobContext {
  taskRunExternalId(): string
  retryCount(): number
  readonly abortController: AbortController
  readonly worker: { id(): string | undefined }
}

export interface BffJobTaskOptions {
  name: string
  retries: number
  executionTimeout: number
  scheduleTimeout: BffJobTaskSpec['scheduleTimeout']
  concurrency: { expression: string; maxRuns: number; limitStrategy: ConcurrencyLimitStrategy }
  idempotency: BffJobTaskSpec['idempotency']
  fn: (input: BffJobTaskInput, ctx: BffJobContext) => Promise<BffJobTaskOutput>
}

export interface BffJobWork {
  run(input: BffJobTaskInput, context: BffJobRunContext, runs: BffJobRuns): Promise<BffJobTaskOutput>
  sweep(runs: BffJobRuns): Promise<{ dispatched: number; failed: number; purged: number }>
}

export interface BffJobWorker {
  start(): Promise<void>
  stop(): Promise<void>
}

export interface HatchetLike<D extends BffJobDeclaration = BffJobDeclaration> {
  task(options: BffJobTaskOptions): D
  worker(name: string, options: { slots: number; handleKill: false; workflows: Array<D | WorkerWorkflow> }): Promise<BffJobWorker>
}

export type WorkerWorkflow = NonNullable<CreateWorkerOpts['workflows']>[number]

let sdk: HatchetClient | null = null

export function hatchetClient(): HatchetClient {
  sdk ??= HatchetClient.init()
  return sdk
}

function sdkClient(): HatchetLike<TaskWorkflowDeclaration<BffJobTaskInput, BffJobTaskOutput>> {
  const hatchet = hatchetClient()
  return {
    task: (options) => hatchet.task<BffJobTaskInput, BffJobTaskOutput>(options),
    worker: (name, options) => hatchet.worker(name, options),
  }
}

const SDK_PRIORITY: Record<1 | 3, Priority> = { 1: Priority.LOW, 3: Priority.HIGH }

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

export function toHatchetError(error: unknown): Error {
  if (error instanceof PermanentJobError) return new NonRetryableError(error.message)
  if (error instanceof RetryLaterError) {
    return error.afterSeconds > 0 ? new RetryAfterError(error.message, { after: `${error.afterSeconds}s` }) : new Error(error.message)
  }
  console.error('[bff-jobs] a run failed:', error)
  return new Error(failureText('run-failed', error))
}

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
      const context: BffJobRunContext = {
        run: ctx.taskRunExternalId(),
        retryCount: ctx.retryCount(),
        workerId: ctx.worker.id(),
        signal: ctx.abortController.signal,
      }
      try {
        return await work().run(input, context, runs())
      } catch (error) {
        throw toHatchetError(error)
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
let installed: BffJobWork | null = null

function bffJobTask(): BffJobTask {
  if (current) return current
  const spec = bffJobTaskSpec()
  const client = fake ?? sdkClient()
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

export function useHatchetForTests(client: HatchetLike | null): void {
  fake = client
  current = null
  installed = null
}

export function triggerBffJob(input: BffJobTaskInput, options: { notBefore?: Date } = {}): Promise<void> {
  return bffJobTask().runs.trigger(input, options)
}

const SWEEP_EVERY_MS = 60_000

export async function startBffJobWorker(
  name: string,
  work: BffJobWork,
  alsoRuns: readonly WorkerWorkflow[] = []
): Promise<{ done: Promise<void>; stop: () => Promise<void> }> {
  installed = work
  const { client, declaration, runs, spec } = bffJobTask()
  const worker = await client.worker(name, { slots: spec.slots, handleKill: false, workflows: [declaration, ...alsoRuns] })
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
