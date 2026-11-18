import 'server-only'
import { v5 as uuidv5 } from 'uuid'
import { BadRequestError, ConflictError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { requireProjectAccess } from '@/lib/authz/projects'
import { projectClosedError } from '@/lib/projects/project-status'
import { normalizeAgentAnswerMetadata } from '@/lib/conversations/agent-answer-metadata'
import {
  findMessageInConversation,
  insertMessages,
  mergeMessageMetadata,
  writeMessageContent,
} from '@/lib/conversations/repository'
import type { Message } from '@/lib/db/schema/messages'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import {
  addDocumentToBackendJob,
  cancelBackendJob,
  JobCancelError,
  writeNowBackendJob,
  type JobControlCaller,
} from '@/lib/jobs/backend-client'
import { signJobRequestContext } from '@/lib/jobs/request-envelope'
import type { PlanDocument } from './plan-documents'
import { AGENT_REFUSAL_LOCALE, requirePlanDocumentsOpen } from '@/lib/conversations/restricted-egress'
import type { Locale } from '@/i18n/config'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems, resolveInboxItemsFor } from '@/lib/inbox/service'
import * as taskRepository from '@/lib/tasks/repository'
import { requireMaySeeSubject } from '@/lib/tasks/subject-access'
import { isActiveTaskRunStatus } from '@/lib/tasks/task-vocabulary'
import { RUN_REPORT_MAX_CHARS, type RunViewQuery } from '@/lib/tasks/task-wire'
import { requireResourceAccess } from '@/lib/sharing/access'
import {
  applyRunLedgerAppend,
  applyRunLedgerFinish,
  emptyRunLedger,
  sanitizeRunLedger,
  sanitizeRunTitle,
} from './run-ledger'
import type { RunLedger, RunLedgerRequest, RunLedgerResponse, RunView } from './run-ledger-types'
import { isLiveStatus, runDisplayStatus } from './run-vocabulary'

export const RUN_LEDGER_METADATA_KEY = 'run_ledger'
export const RUN_TITLE_METADATA_KEY = 'run_title'

export interface CreateRunMessageOptions {
  title?: string | null
  at?: Date
}

export function runMessageId(runId: string): string {
  return uuidv5(`grid:run:${runId}`, uuidv5.URL)
}

export async function createRunMessage(
  conversationId: string,
  runId: string,
  options: CreateRunMessageOptions = {}
): Promise<Message> {
  const at = options.at ?? new Date()
  const id = runMessageId(runId)
  const title = sanitizeRunTitle(options.title)
  const [inserted] = await insertMessages([
    {
      id,
      conversationId,
      role: 'assistant',
      runId,
      content: '',
      metadata: {
        messageType: 'agent_response',
        [RUN_LEDGER_METADATA_KEY]: emptyRunLedger(runId, at),
        ...(title ? { [RUN_TITLE_METADATA_KEY]: title } : {}),
      },
      createdAt: at,
    },
  ])
  if (inserted) return inserted
  const existing = await findMessageInConversation(conversationId, id)
  if (!existing) throw new NotFoundError('The run message could not be created')
  return existing
}

async function loadRunForLedger(runId: string) {
  return withPlatformAccess(
    'run ledger: the worker names a run by id, before any organization is known',
    () => taskRepository.findRunById(runId)
  )
}

function storedLedger(message: Message): RunLedger | null {
  const metadata = (message.metadata ?? {}) as Record<string, unknown>
  return sanitizeRunLedger(metadata[RUN_LEDGER_METADATA_KEY])
}

function finishOutcome(op: Extract<RunLedgerRequest, { op: 'finish' }>) {
  if (op.result && op.error) {
    throw new BadRequestError('A finished run has a result or an error, never both')
  }
  if (op.result) return { result: op.result }
  if (op.error) return { error: op.error }
  throw new BadRequestError('A finished run must say what it produced or why it stopped')
}

export async function applyRunLedgerOp(
  runId: string,
  op: RunLedgerRequest,
  at: Date = new Date()
): Promise<RunLedgerResponse> {
  const { ledger } = await foldRunLedgerOp(runId, op, at, false)
  return { runId, ledger }
}

async function foldRunLedgerOp(
  runId: string,
  op: RunLedgerRequest,
  at: Date,
  onlyIfLive: boolean
): Promise<{ ledger: RunLedger; applied: boolean }> {
  const run = await loadRunForLedger(runId)
  if (!run) throw new NotFoundError('Unknown run')
  if (!run.conversationId || !run.runMessageId) {
    throw new NotFoundError('This run has no message to write a ledger into')
  }
  const conversationId = run.conversationId
  const messageId = run.runMessageId

  return withTenant({ organizationId: run.organizationId }, async () => {
    let current = emptyRunLedger(runId, run.createdAt)
    let ledger = current
    let applied = false
    const stored = await mergeMessageMetadata(conversationId, messageId, (metadata) => {
      current = sanitizeRunLedger(metadata[RUN_LEDGER_METADATA_KEY]) ?? current
      ledger = current
      if (onlyIfLive && !isLiveStatus(runDisplayStatus(current))) return null
      const next =
        op.op === 'append'
          ? applyRunLedgerAppend(current, op, at)
          : applyRunLedgerFinish(current, finishOutcome(op), at)
      ledger = sanitizeRunLedger(next) ?? current
      applied = true
      return { [RUN_LEDGER_METADATA_KEY]: ledger }
    })
    if (!stored) throw new NotFoundError('This run has no message to write a ledger into')
    if (!onlyIfLive) await markStartedIfQueued(run, at)
    await notifyWaiting(run, current, ledger)
    return { ledger, applied }
  })
}

async function markStartedIfQueued(run: TaskRun, at: Date): Promise<void> {
  if (run.status !== 'queued') return
  try {
    await taskRepository.markRunStarted(run.id, run.organizationId, at)
  } catch (error) {
    console.warn('[runs] could not move run', run.id, 'from queued to running', error)
  }
}

export interface RunEnding {
  status: 'success' | 'failure' | 'interrupted'
  error?: string | null
}

const DEFAULT_FAILURE_REASON = 'Der Lauf ist fehlgeschlagen.'

export function ledgerOpForEnding(ending: RunEnding, at: Date): RunLedgerRequest {
  if (ending.status === 'success') return { op: 'finish', result: { filedAt: at.toISOString() } }
  if (ending.status === 'interrupted') return { op: 'append', status: 'cancelled' }
  return { op: 'finish', error: { reason: (ending.error || DEFAULT_FAILURE_REASON).slice(0, 400) } }
}

export async function settleRunLedger(
  run: Pick<TaskRun, 'id' | 'conversationId' | 'runMessageId'>,
  ending: RunEnding,
  at: Date = new Date()
): Promise<boolean> {
  if (!run.conversationId || !run.runMessageId) return false
  try {
    const { applied } = await foldRunLedgerOp(run.id, ledgerOpForEnding(ending, at), at, true)
    return applied
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error
    return false
  }
}

async function notifyWaiting(run: TaskRun, before: RunLedger, after: RunLedger): Promise<void> {
  const wasWaiting = runDisplayStatus(before) === 'waiting'
  const isWaiting = runDisplayStatus(after) === 'waiting'
  if (wasWaiting === isWaiting) return
  const groupKey = inboxGroupKey('task_run.waiting', 'project', run.projectId, run.id)
  try {
    if (!isWaiting) {
      const legacyGroupKey = `job.waiting${groupKey.slice('task_run.waiting'.length)}`
      await resolveInboxItemsFor([
        { organizationId: run.organizationId, recipientUserId: run.requesterUserId, groupKey },
        { organizationId: run.organizationId, recipientUserId: run.requesterUserId, groupKey: legacyGroupKey },
      ])
      return
    }
    await emitInboxItems([
      {
        organizationId: run.organizationId,
        recipientUserId: run.requesterUserId,
        type: 'task_run.waiting',
        resourceType: 'project',
        resourceId: run.projectId,
        anchorId: run.id,
        actorUserId: null,
        groupKey,
        payload: {
          subject: run.title,
          jobId: run.definitionId,
          runId: run.id,
          conversationId: run.conversationId,
          runMessageId: run.runMessageId,
          taskId: run.id,
        },
      },
    ])
  } catch (err) {
    console.warn('[runs] could not update the waiting row for run', run.id, err)
  }
}

export async function findRunMessageByBackendJobId(
  backendJobId: string
): Promise<{ runId: string; conversationId: string; messageId: string } | null> {
  const run = await withPlatformAccess(
    'run message lookup: the worker names a run by its backend job id, before any organization is known',
    () => taskRepository.findRunByBackendJobId(backendJobId)
  )
  if (!run?.conversationId || !run.runMessageId) return null
  return { runId: run.id, conversationId: run.conversationId, messageId: run.runMessageId }
}

export async function writeRunReport(
  backendJobId: string,
  report: { content: string; metadata?: Record<string, unknown> }
): Promise<{ runId: string; conversationId: string; messageId: string }> {
  const target = await findRunMessageByBackendJobId(backendJobId)
  if (!target) throw new NotFoundError('This run has no message to write a report into')

  const run = await loadRunForLedger(target.runId)
  if (!run) throw new NotFoundError('Unknown run')

  return withTenant({ organizationId: run.organizationId }, async () => {
    const written = await writeMessageContent(
      target.conversationId,
      target.messageId,
      report.content,
      normalizeAgentAnswerMetadata(report.metadata ?? {}) ?? {}
    )
    if (!written) throw new NotFoundError('This run has no message to write a report into')
    return target
  })
}

export async function readRunMessage(
  run: Pick<TaskRun, 'conversationId' | 'runMessageId'>
): Promise<{ content: string; ledger: RunLedger | null } | null> {
  if (!run.conversationId || !run.runMessageId) return null
  const message = await findMessageInConversation(run.conversationId, run.runMessageId)
  if (!message) return null
  return { content: message.content ?? '', ledger: storedLedger(message) }
}

export async function getRunView(
  session: AuthorizedSession,
  projectId: string,
  runId: string,
  query: RunViewQuery = {}
): Promise<RunView> {
  await requireProjectAccess(session, projectId, 'project:view')
  const run = await taskRepository.findRunInProject(runId, projectId, session.organizationId)
  if (!run) throw new NotFoundError('Unknown run')
  await requireMaySeeSubject(session, projectId, run, 'Unknown run')
  const message = await runMessageOf(run)
  const view: RunView = {
    ...viewOf(run, message),
    report: await reportOf(session, run, message),
  }
  return query.include === 'stream' ? { ...view, backendJobId: run.backendJobId } : view
}

async function runMessageOf(run: TaskRun): Promise<Message | null> {
  return run.conversationId && run.runMessageId
    ? findMessageInConversation(run.conversationId, run.runMessageId)
    : null
}

function viewOf(run: TaskRun, message: Message | null): RunView {
  return {
    runId: run.id,
    taskId: run.definitionId,
    conversationId: run.conversationId,
    messageId: run.runMessageId,
    status: run.status,
    ledger: message ? storedLedger(message) : null,
  }
}

async function reportOf(
  session: AuthorizedSession,
  run: TaskRun,
  message: Message | null
): Promise<NonNullable<RunView['report']>> {
  const content = message?.content?.trim() ?? ''
  const mayRead =
    content.length > 0 && run.conversationId
      ? await requireResourceAccess(session, 'conversation', run.conversationId, 'viewer').then(
          () => true,
          () => false
        )
      : false
  const text = mayRead ? content : null
  return {
    text: text === null ? null : text.slice(0, RUN_REPORT_MAX_CHARS),
    truncated: text !== null && text.length > RUN_REPORT_MAX_CHARS,
    filedDocumentId: run.filedDocumentId ?? null,
  }
}

async function runView(run: TaskRun): Promise<RunView> {
  return viewOf(run, await runMessageOf(run))
}

async function requireRunActor(
  session: AuthorizedSession,
  projectId: string,
  runId: string,
  options: { write?: boolean } = {}
): Promise<TaskRun> {
  await requireProjectAccess(session, projectId, 'project:view')
  const access = await requireProjectAccess(session, projectId, CHAT_PERMISSIONS)
  if (options.write && access.closed) throw projectClosedError()
  const run = await taskRepository.findRunInProject(runId, projectId, session.organizationId)
  if (!run) throw new NotFoundError('Unknown run')
  if (access.readsBecauseClosed && run.requesterUserId !== session.userId) throw new NotFoundError('Unknown run')
  await requireMaySeeSubject(session, projectId, run, 'Unknown run')
  return run
}

async function jobControlCaller(
  session: AuthorizedSession,
  projectId: string
): Promise<JobControlCaller> {
  const scope = await buildCollectionScopeFromRequest(session, { projectId })
  return {
    accessToken: session.accessToken ?? null,
    contextHeaders: signJobRequestContext(session, scope),
  }
}

export async function cancelRun(
  session: AuthorizedSession,
  projectId: string,
  runId: string
): Promise<RunView> {
  const run = await requireRunActor(session, projectId, runId)
  if (!isActiveTaskRunStatus(run.status)) throw new ConflictError('This run has already ended')
  if (!run.backendJobId) throw new ConflictError('This run has no backend job to cancel')

  try {
    await cancelBackendJob(run.backendJobId, await jobControlCaller(session, projectId))
  } catch (error) {
    if (!(error instanceof JobCancelError)) throw error
    if (error.status === 400) throw new ConflictError('This run has already ended')
    if (error.status === 404) throw new NotFoundError('Unknown run')
    throw new UpstreamError('The run could not be cancelled')
  }
  return runView(run)
}

export async function addRunDocument(
  session: AuthorizedSession,
  projectId: string,
  runId: string,
  document: PlanDocument,
  locale: Locale = AGENT_REFUSAL_LOCALE
): Promise<RunView> {
  const run = await requireRunActor(session, projectId, runId, { write: true })
  if (!isActiveTaskRunStatus(run.status)) throw new ConflictError('This run has already ended')
  if (!run.backendJobId) throw new ConflictError('This run has no backend job to hand the document to')
  await requirePlanDocumentsOpen(session.organizationId, projectId, [document], locale)

  try {
    await addDocumentToBackendJob(run.backendJobId, document, await jobControlCaller(session, projectId))
  } catch (error) {
    if (!(error instanceof JobCancelError)) throw error
    if (error.status === 400) throw new ConflictError('This run has already ended')
    if (error.status === 404) throw new NotFoundError('Unknown run')
    throw new UpstreamError('The document could not be handed to the run')
  }
  return runView(run)
}

export async function writeNowRun(
  session: AuthorizedSession,
  projectId: string,
  runId: string
): Promise<RunView> {
  const run = await requireRunActor(session, projectId, runId)
  if (!isActiveTaskRunStatus(run.status)) throw new ConflictError('This run has already ended')
  if (!run.backendJobId) throw new ConflictError('This run has no backend job to write from')

  try {
    await writeNowBackendJob(run.backendJobId, await jobControlCaller(session, projectId))
  } catch (error) {
    if (!(error instanceof JobCancelError)) throw error
    if (error.status === 400) throw new ConflictError('This run has already ended')
    if (error.status === 404) throw new NotFoundError('Unknown run')
    throw new UpstreamError('The run could not be asked to write now')
  }
  return runView(run)
}
