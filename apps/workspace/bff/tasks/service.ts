import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import { ApiError, BadRequestError, ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import {
  decodeDocumentListCursor,
  encodeDocumentListCursor,
  type DocumentListCursor,
} from '@/lib/documents/list-cursor'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { InboxItemType } from '@/lib/db/schema/inbox'
import type { TaskRun, TaskRunStatus } from '@/lib/db/schema/task-model'
import type { TaskKind } from '@/lib/db/schema/task-model'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { emitInboxItems } from '@/lib/inbox/service'
import { fileAgentDocumentDraft } from '@/lib/documents/agent-document'
import {
  replaceVersionContent,
  transitionDocumentVersion,
} from '@/lib/documents/lifecycle'
import { findDocumentInOrg } from '@/lib/documents/repository'
import { internalRead } from '@/lib/documents/document-reader'
import { openDraftForRevision } from '@/lib/documents/revision'
import { fileResearchReport, queueResearchReportFiling } from '@/lib/documents/research-report'
import type { FileResearchReportPayload, JobAttempt } from '@/lib/jobs-queue/types'
import { sessionOf } from '@/lib/jobs-queue/types'
import { endingOfClosedRun } from '@/lib/runs/run-ending'
import { settleRunLedger } from '@/lib/runs/service'
import { resolvePeople } from '@/lib/sharing/directory'
import { loadRunSummaries, toTaskRunView } from './list-projection'
import * as repository from './repository'
import type { KeysetPage } from './repository'
import type { TaskRunListQuery, TaskRunPage, TaskRunView } from './task-wire'
import { requireMaySeeSubject, withoutUnreadableSubjects } from './subject-access'
import { isActiveTaskRunStatus } from './task-vocabulary'
import type { ReviewTaskInput } from './types'

export type TaskOutcomeStatus = 'success' | 'failure' | 'interrupted'
export type { TaskOutcomeStatus as JobOutcomeStatus }

export interface TaskOutcome {
  status: TaskOutcomeStatus
  error?: string | null
  report?: string | null
  cards?: unknown[] | null
}

const OUTCOME_TO_STATUS: Record<TaskOutcomeStatus, TaskRunStatus> = {
  success: 'succeeded',
  failure: 'failed',
  interrupted: 'interrupted',
}

export async function loadRunForOutcome(backendJobId: string): Promise<TaskRun | null> {
  return repository.findRunByBackendJobId(backendJobId)
}

export interface RecordOutcomeOptions {
  onlyIfActive?: boolean
}

type CompletedRun = { run: TaskRun; filed: { documentId: string; filename: string } | null }

function closingPatch(outcome: TaskOutcome) {
  return { status: OUTCOME_TO_STATUS[outcome.status], error: outcome.error ?? null }
}

async function settleBlock(run: TaskRun, standing: TaskRun): Promise<void> {
  try {
    await settleRunLedger(run, endingOfClosedRun(standing), standing.finishedAt ?? new Date())
  } catch (error) {
    console.error('[runs] the block of run', run.id, 'could not be settled; the heal will', error)
  }
}

export async function completeRunForOutcome(
  run: TaskRun,
  outcome: TaskOutcome,
  options: RecordOutcomeOptions = {},
): Promise<(CompletedRun & { first: boolean }) | null> {
  const closed = await repository.closeActiveRun(run.id, run.organizationId, closingPatch(outcome))
  const standing = closed ?? (await repository.findRunById(run.id))
  if (!standing) return null
  await settleBlock(run, standing)
  const repeated = !options.onlyIfActive && standing.status === OUTCOME_TO_STATUS[outcome.status]
  if (!closed && !repeated) return null
  return { ...(await afterClose(run, standing, outcome)), first: closed !== null }
}

async function afterClose(run: TaskRun, closed: TaskRun, outcome: TaskOutcome): Promise<CompletedRun> {
  const status = OUTCOME_TO_STATUS[outcome.status]
  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: { userId: run.requesterUserId, email: run.requesterEmail },
    action: 'task.completed',
    targetType: 'task',
    targetId: run.id,
    metadata: { projectId: run.projectId, kind: run.kind, status },
  })

  if (status !== 'succeeded' || !outcome.report || !FILES_ITS_RESULT[run.kind]) {
    return { run: closed, filed: null }
  }
  if (run.kind === 'deep-research') {
    return { run: await queueReportFiling(closed, outcome.report, outcome.cards ?? undefined), filed: null }
  }
  const filing = await fileAsRequester(closed, outcome.report)
  const withFiling = (await repository.updateRun(run.id, run.organizationId, filingPatch(filing))) ?? closed
  return { run: withFiling, filed: filing.filed }
}

const FILES_ITS_RESULT: Record<TaskKind, boolean> = {
  'deep-research': true,
  chat: false,
  compliance_check: false,
  submission_check: false,
  document: true,
  revision: true,
}

interface FilingResult {
  status: 'filed' | 'refused' | 'failed'
  detail: string | null
  filed: { documentId: string; filename: string } | null
}

function filingPatch(filing: FilingResult) {
  return {
    filingStatus: filing.status,
    filingDetail: filing.detail,
    filedDocumentId: filing.filed?.documentId ?? null,
  }
}

async function queueReportFiling(run: TaskRun, report: string, cards?: unknown[]): Promise<TaskRun> {
  const record = async (patch: Parameters<typeof repository.updateRun>[2]): Promise<TaskRun> =>
    (await repository.updateRun(run.id, run.organizationId, patch)) ?? run

  if (run.filingStatus === 'filed' && run.filedDocumentId) return run
  if (!run.backendJobId) {
    return record(filingPatch({ status: 'failed', detail: 'run has no backend job id', filed: null }))
  }
  try {
    const queued = await record({ filingStatus: 'queued', filingDetail: null, filedDocumentId: null })
    await queueResearchReportFiling({
      organizationId: run.organizationId,
      payload: {
        runId: run.backendJobId,
        projectId: run.projectId,
        report,
        ...(cards ? { cards } : {}),
        taskRunId: run.id,
        requester: null,
      },
    })
    return queued
  } catch (error) {
    console.error('[runs] queueing the report filing failed for run', run.id, error)
    const name = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
    return record(filingPatch({ status: 'failed', detail: `could not queue the filing: ${name}`.slice(0, 500), filed: null }))
  }
}

export async function runReportFilingJob(
  organizationId: string,
  payload: FileResearchReportPayload,
  attempt: JobAttempt,
): Promise<void> {
  const run = payload.taskRunId ? await repository.findRunById(payload.taskRunId) : null
  const record = async (filing: FilingResult): Promise<void> => {
    if (run) await repository.updateRun(run.id, organizationId, filingPatch(filing))
  }

  const session = payload.requester
    ? sessionOf(payload.requester, organizationId)
    : run
      ? await resolvePinnedRequesterSession({
          userId: run.requesterUserId,
          email: run.requesterEmail,
          organizationId,
        })
      : null
  if (!session) {
    return record({ status: 'refused', detail: 'requester is no longer a member of the organization', filed: null })
  }

  try {
    const filed = await fileResearchReport({
      session,
      projectId: payload.projectId,
      runId: payload.runId,
      report: payload.report,
      cards: payload.cards,
    })
    return record({ status: 'filed', detail: null, filed: { documentId: filed.documentId, filename: filed.filename } })
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return record({ status: 'refused', detail: `${error.name}: ${error.message}`.slice(0, 500), filed: null })
    }
    console.error('[runs] filing the report failed for run', payload.taskRunId ?? payload.runId, error)
    if (attempt.last) {
      const name = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
      await record({ status: 'failed', detail: name.slice(0, 500), filed: null }).catch(() => undefined)
    }
    throw error
  }
}

async function fileAsRequester(run: TaskRun, report: string): Promise<FilingResult> {
  if (!run.backendJobId) return { status: 'failed', detail: 'run has no backend job id', filed: null }

  const session = await resolvePinnedRequesterSession({
    userId: run.requesterUserId,
    email: run.requesterEmail,
    organizationId: run.organizationId,
  })
  if (!session) {
    return { status: 'refused', detail: 'requester is no longer a member of the organization', filed: null }
  }

  try {
    const filed = await fileResultFor(run, session, report)
    return { status: 'filed', detail: null, filed }
  } catch (error) {
    if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
      return { status: 'refused', detail: `${error.name}: ${error.message}`.slice(0, 500), filed: null }
    }
    console.error('[runs] filing the report failed for run', run.id, error)
    const name = error instanceof Error ? `${error.name}: ${error.message}` : 'unknown error'
    return { status: 'failed', detail: name.slice(0, 500), filed: null }
  }
}

async function fileResultFor(
  run: TaskRun,
  session: AuthorizedSession,
  report: string,
): Promise<{ documentId: string; filename: string }> {
  if (run.kind === 'revision') {
    const subject = run.plan.subject
    if (!subject) throw new UnprocessableError('A revision run carries no version to revise')
    const draft = await openDraftForRevision(session, subject.documentId)
    const replaced = await replaceVersionContent(
      session,
      subject.documentId,
      draft.version.id,
      report,
      draft.version.contentHash ?? undefined,
      { actingHuman: false },
    )
    await transitionDocumentVersion(session, subject.documentId, replaced.id, 'submit', {
      reviewerUserIds: draft.reviewers,
      actingHuman: false,
    })
    return { documentId: subject.documentId, filename: draft.filename }
  }

  const filed = await fileAgentDocumentDraft({
    op: 'create',
    session,
    projectId: run.projectId,
    ref: `task-${run.id}`,
    title: run.plan.goal?.trim() || run.title,
    content: report,
    actingHuman: false,
  })
  if (!filed.alreadyFiled) {
    await transitionDocumentVersion(session, filed.documentId, filed.version.id, 'submit', {
      reviewerUserIds: [run.requesterUserId],
      actingHuman: false,
    })
  }
  const document = await findDocumentInOrg(filed.documentId, session.organizationId, internalRead('just-written'))
  return { documentId: filed.documentId, filename: document?.filename ?? `task-${run.id}` }
}

function announceRunFinished(run: TaskRun, outcome: TaskOutcome, closed: TaskRun): void {
  const startedAt = new Date(run.startedAt ?? run.createdAt).getTime()
  const durationMs = Date.now() - startedAt
  captureServer({
    event: 'job_run_finished',
    distinctId: run.requesterUserId,
    organizationId: run.organizationId,
    properties: {
      job_id: run.definitionId,
      run_id: run.id,
      status: outcome.status,
      trigger: run.trigger,
      output: run.kind,
      filing_status: closed.filingStatus,
      duration_ms: Number.isFinite(durationMs) ? Math.max(0, durationMs) : undefined,
    },
  })
}

export async function recordRunOutcome(
  run: TaskRun,
  outcome: TaskOutcome,
  options: RecordOutcomeOptions = {},
): Promise<{ notified: boolean; filed: { documentId: string; filename: string } | null; closed: boolean }> {
  const completed = await completeRunForOutcome(run, outcome, options)
  if (!completed) return { notified: false, filed: null, closed: false }
  if (completed.first) announceRunFinished(run, outcome, completed.run)

  const type: InboxItemType = outcome.status === 'success' ? 'task_run.completed' : 'task_run.failed'
  const anchor = run.backendJobId ?? run.id
  const emitted = await emitInboxItems([
    {
      organizationId: run.organizationId,
      recipientUserId: run.requesterUserId,
      type,
      resourceType: 'project',
      resourceId: run.projectId,
      anchorId: anchor,
      actorUserId: null,
      groupKey: inboxGroupKey(type, 'project', run.projectId, anchor),
      payload: {
        subject: run.title,
        status: outcome.status,
        error: outcome.error ?? null,
        jobId: run.definitionId,
        runId: run.id,
        conversationId: run.conversationId,
        runMessageId: run.runMessageId,
        taskId: run.id,
        filedDocumentId: completed.filed?.documentId ?? null,
        filedFilename: completed.filed?.filename ?? null,
      },
    },
  ])
  return { notified: emitted > 0, filed: completed.filed, closed: true }
}

export async function listTaskRuns(
  session: AuthorizedSession,
  projectId: string,
  query: Pick<TaskRunListQuery, 'limit' | 'taskId' | 'status' | 'review'> & { cursor?: string },
): Promise<KeysetPage<TaskRun>> {
  await requireProjectAccess(session, projectId, 'project:view')
  const page = await repository.listRunPage(projectId, session.organizationId, {
    limit: query.limit,
    cursor: decodeCursorParam(query.cursor),
    definitionId: query.taskId,
    status: query.status,
    review: query.review,
  })
  return { rows: await withoutUnreadableSubjects(session, projectId, page.rows), next: page.next }
}

export async function toTaskRunViews(
  organizationId: string,
  runs: readonly TaskRun[],
): Promise<TaskRunView[]> {
  if (runs.length === 0) return []
  const [people, summaries] = await Promise.all([
    resolvePeople(organizationId, [...new Set(runs.map((run) => run.requesterUserId))]),
    loadRunSummaries(runs),
  ])
  return runs.map((run) =>
    toTaskRunView(run, people.get(run.requesterUserId)?.name ?? null, summaries.get(run.id) ?? null),
  )
}

export async function listTaskRunViews(
  session: AuthorizedSession,
  projectId: string,
  query: TaskRunListQuery,
): Promise<TaskRunPage> {
  const page = await listTaskRuns(session, projectId, query)
  return {
    runs: await toTaskRunViews(session.organizationId, page.rows),
    nextCursor: page.next ? encodeDocumentListCursor(page.next) : null,
  }
}

export function decodeCursorParam(cursor: string | undefined): DocumentListCursor | null {
  if (!cursor) return null
  const decoded = decodeDocumentListCursor(cursor)
  if (!decoded) throw new BadRequestError('cursor is not a nextCursor this list returned')
  return decoded
}

export async function reviewTask(
  session: AuthorizedSession,
  projectId: string,
  runId: string,
  input: ReviewTaskInput,
  request?: Request,
): Promise<TaskRun> {
  await requireProjectAccess(session, projectId, 'project:edit')
  const run = await repository.findRunInProject(runId, projectId, session.organizationId)
  if (!run) throw new NotFoundError('Task run not found')
  await requireMaySeeSubject(session, projectId, run)
  if (isActiveTaskRunStatus(run.status)) {
    throw new ConflictError('A task run can only be reviewed once it has finished')
  }

  const reason = input.reason?.trim() || null
  const reviewed = await repository.updateRun(run.id, session.organizationId, {
    review: input.decision,
    reviewReason: reason,
    reviewedBy: session.userId,
    reviewedAt: new Date(),
  })
  if (!reviewed) throw new NotFoundError('Task run not found')

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'task.reviewed',
    targetType: 'task',
    targetId: run.id,
    metadata: { projectId, kind: run.kind, decision: input.decision, withReason: reason !== null },
    request,
  })
  return reviewed
}

export const PREVIOUS_DECISIONS_HEADER = 'PREVIOUS_DECISIONS v1'

export async function previousDecisionsBlock(
  definition: Pick<TaskRun, 'definitionId' | 'organizationId'> | { id: string; organizationId: string },
): Promise<string> {
  const definitionId = 'id' in definition ? definition.id : definition.definitionId
  if (!definitionId) return ''
  let rejections: Array<{ reviewReason: string | null; reviewedAt: Date | null }>
  try {
    rejections = await repository.listRejectedReviewsForDefinition(
      definitionId,
      definition.organizationId,
    )
  } catch (error) {
    console.warn('[runs] could not load earlier decisions for definition', definitionId, error)
    return ''
  }
  const lines = rejections
    .filter((row): row is { reviewReason: string; reviewedAt: Date | null } => Boolean(row.reviewReason))
    .map((row) => {
      const when = row.reviewedAt ? row.reviewedAt.toISOString().slice(0, 10) : ''
      return `- [abgelehnt${when ? `, ${when}` : ''}] ${row.reviewReason}`
    })
  if (lines.length === 0) return ''
  return [
    `### ${PREVIOUS_DECISIONS_HEADER}`,
    'Frühere Ergebnisse dieses Auftrags wurden von einer Person geprüft und mit der',
    'folgenden Begründung abgelehnt. Eine Ablehnung ist eine Entscheidung, keine',
    'Frage: Berücksichtige sie in diesem Lauf, wiederhole nicht, was abgelehnt',
    'wurde, und sage im Ergebnis, wo du ihr gefolgt bist.',
    ...lines,
  ].join('\n')
}
