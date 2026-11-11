/**
 * A run asks a person, and a person answers (ADR-0181): the rules.
 *
 * Two callers. The WORKER asks and reads back; its identity is the run row, as
 * for the ledger (`./service`, `applyRunLedgerOp`): the run is resolved under
 * platform access and everything after runs in that run's own organization. A
 * PERSON lists and settles; the gate is the one every person's act on a run
 * passes (`requireRunActor`).
 *
 * The run ledger follows: a new question moves it to `waiting`, and the answer
 * that leaves none open moves it back to `running`. Both are the ledger's own
 * moves (`RUN_LEDGER_LIFECYCLE`), so the inbox row and the run block react as
 * they were built to. A ledger that cannot be written (a run with no message)
 * never refuses the question: the row is the record.
 *
 * Nothing sweeps stale requests. Each read settles them first: a request past
 * its deadline is `expired`, and the open requests of a run that has ended are
 * `cancelled`, because nobody is left to read the answer.
 */

import 'server-only'
import { BadRequestError, ConflictError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { decodeDocumentListCursor, encodeDocumentListCursor } from '@/lib/documents/list-cursor'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import * as taskRepository from '@/lib/tasks/repository'
import { isActiveTaskRunStatus } from '@/lib/tasks/task-vocabulary'
import * as repository from './input-request-repository'
import type { RunInputRequest, RunKey } from './input-request-repository'
import {
  MAX_OPEN_INPUT_REQUESTS,
  inputContentProblems,
  inputRequestResolveProblem,
  type InputRequestCreate,
  type InputRequestList,
  type InputRequestListQuery,
  type InputRequestResolve,
  type InputRequestView,
} from './input-request-types'
import { applyRunLedgerOp, requireRunActor } from './service'

const keyOf = (run: TaskRun): RunKey => ({ organizationId: run.organizationId, runId: run.id })

export function toInputRequestView(row: RunInputRequest): InputRequestView {
  return {
    id: row.id,
    runId: row.runId,
    status: row.status,
    reason: row.reason,
    message: row.message,
    requestedSchema: row.requestedSchema,
    ...(row.status === 'answered' && row.content ? { content: row.content } : {}),
    createdAt: new Date(row.createdAt).toISOString(),
    ...(row.expiresAt ? { expiresAt: new Date(row.expiresAt).toISOString() } : {}),
    ...(row.decidedAt ? { decidedAt: new Date(row.decidedAt).toISOString() } : {}),
    ...(row.decidedBy ? { decidedBy: row.decidedBy } : {}),
  }
}

/** The run a worker names by id, before any organization is known. */
async function loadRunForWorker(runId: string): Promise<TaskRun> {
  const run = await withPlatformAccess('run input request: the worker names a run by id, before any organization is known', () =>
    taskRepository.findRunById(runId)
  )
  if (!run) throw new NotFoundError('Unknown run')
  return run
}

/** Close what can no longer be answered, before anything reads the run's requests. */
async function settleStale(run: TaskRun, at: Date): Promise<void> {
  await repository.expireDue(keyOf(run), at)
  if (!isActiveTaskRunStatus(run.status)) await repository.cancelOpen(keyOf(run), at)
}

/** Move the run's ledger; a run with no message to carry one is not a refusal. */
async function moveLedger(runId: string, status: 'waiting' | 'running', at: Date): Promise<void> {
  try {
    await applyRunLedgerOp(runId, { op: 'append', status }, at)
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
  }
}

// ---------------------------------------------------------------------------
// The worker
// ---------------------------------------------------------------------------

/**
 * The run asks. Refused with 409 when the run has ended, or already has
 * {@link MAX_OPEN_INPUT_REQUESTS} questions open. A retried post with the same
 * key answers the first request and moves nothing.
 */
export async function askForInput(runId: string, body: InputRequestCreate, at: Date = new Date()): Promise<InputRequestView> {
  const run = await loadRunForWorker(runId)
  if (!isActiveTaskRunStatus(run.status)) throw new ConflictError('This run has already ended')
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null
  if (expiresAt && expiresAt <= at) throw new BadRequestError('expiresAt must lie in the future')
  await repository.expireDue(keyOf(run), at)
  if ((await repository.countOpen(keyOf(run))) >= MAX_OPEN_INPUT_REQUESTS) {
    throw new ConflictError(`A run may have at most ${MAX_OPEN_INPUT_REQUESTS} questions open`)
  }
  const { row, created } = await repository.insertOrFind({
    ...keyOf(run),
    projectId: run.projectId,
    idempotencyKey: body.idempotencyKey,
    reason: body.reason,
    message: body.message,
    requestedSchema: body.requestedSchema,
    expiresAt,
  })
  if (created) await moveLedger(run.id, 'waiting', at)
  return toInputRequestView(row)
}

/** The run reads one of its requests, and the answer once there is one. */
export async function readInputRequestForRun(runId: string, requestId: string, at: Date = new Date()): Promise<InputRequestView> {
  const run = await loadRunForWorker(runId)
  await settleStale(run, at)
  const row = await repository.findInRun(keyOf(run), requestId)
  if (!row) throw new NotFoundError('Unknown input request')
  return toInputRequestView(row)
}

// ---------------------------------------------------------------------------
// A person
// ---------------------------------------------------------------------------

/** One page of a run's requests, newest first, for anyone who may act on the run. */
export async function listInputRequests(
  session: AuthorizedSession,
  projectId: string,
  runId: string,
  query: InputRequestListQuery,
  at: Date = new Date()
): Promise<InputRequestList> {
  const run = await requireRunActor(session, projectId, runId)
  const cursor = query.cursor ? decodeDocumentListCursor(query.cursor) : null
  if (query.cursor && !cursor) throw new BadRequestError('cursor is not a nextCursor this list returned')
  await settleStale(run, at)
  const page = await repository.listForRun(keyOf(run), { limit: query.limit, cursor })
  return {
    requests: page.rows.map(toInputRequestView),
    nextCursor: page.next ? encodeDocumentListCursor(page.next) : null,
  }
}

/**
 * A person answers or declines one request. 400 when the answer does not fit
 * what was asked, 404 for a request that is not this run's, 409 when it is no
 * longer open: the first final word stands.
 */
export async function resolveInputRequest(
  session: AuthorizedSession,
  projectId: string,
  runId: string,
  requestId: string,
  body: InputRequestResolve,
  at: Date = new Date()
): Promise<InputRequestView> {
  // Answering changes what the run goes on to file into the project: a write.
  const run = await requireRunActor(session, projectId, runId, { write: true })
  await settleStale(run, at)
  const current = await repository.findInRun(keyOf(run), requestId)
  if (!current) throw new NotFoundError('Unknown input request')
  if (current.status !== 'open') throw new ConflictError('This input request has already been settled')

  const pairing = inputRequestResolveProblem(body)
  if (pairing) throw new BadRequestError(pairing)
  const content = body.action === 'accept' ? (body.content ?? {}) : null
  if (content) {
    const problems = inputContentProblems(current.requestedSchema, content)
    if (problems.length > 0) throw new BadRequestError(problems.join('; '))
  }
  const decision = content ? ({ event: 'answer', content } as const) : ({ event: 'decline' } as const)
  const decided = await repository.decide(keyOf(run), requestId, decision, session.userId, at)
  if (!decided) throw new ConflictError('This input request has already been settled')

  if ((await repository.countOpen(keyOf(run))) === 0) await moveLedger(run.id, 'running', at)
  return toInputRequestView(decided)
}
