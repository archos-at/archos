import { normalizeProfileKey, normalizeProfileValue } from '@/lib/project-profile/legacy-names'
import 'server-only'
import { projectLawFor } from '@/lib/base-knowledge/context/project-law'
import { lawWithheldAt } from './classification'
import { ConflictError, ForbiddenError, NotFoundError, ServiceUnavailableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess, type ProjectPermission } from '@/lib/authz/projects'
import type { ProjectIntakeRow } from '@/lib/db/schema/project-intakes'
import { withTenant } from '@/lib/db/tenant-context'
import { fetchBackendJobOutcome, JobProbeError } from '@/lib/jobs/backend-client'
import { recordDecisionScore } from '@/lib/langfuse/decision-score'
import { extractableDocuments, type ExtractableDocument } from '@/lib/project-experience/readable-files'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import { patchProjectProfile } from '@/lib/project-profile/profile-service'
import { salvageProjectProfile } from '@/lib/project-profile/salvage'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { isProjectClosedError, PROJECT_CLOSED_REASON } from '@/lib/projects/project-status'
import { findProjectInOrg, findProjectProfileInOrg } from '@/lib/projects/repository'
import { setProjectStatus } from '@/lib/projects/service'
import { maskAnswerText } from '@/lib/upload-screening/service'
import { onIntakeCompleted, onIntakeReady } from './attention'
import { planDecisions } from './decisions'
import { documentEvidence, reasonFromEvidence } from './evidence'
import { computeNeeds } from './needs'
import { readSetupRecords } from './setup-records'
import { planRecord, planWithdraw, staticRefusal, type ScreenedValue } from './record'
import { setupUnpublished } from './setup-scope'
import { patchForKeys } from './profile-edits'
import {
  addIntakeDismissed,
  claimIntakeReading,
  completeProjectIntake,
  endIntakeReading,
  findProjectIntake,
  findProjectIntakeByJobId,
  requestIntakeRerun,
  setIntakeReadingFiles,
} from './repository'
import { mintIntakeJobId, submitIntakeRun, type IntakeTrigger } from './run'
import { enqueueIntakeRead } from './trigger'
import {
  MAX_DOCUMENTS_READ,
  MAX_INTAKE_NEEDS,
  MAX_UNREAD_FILES,
  STALE_READING_REASON,
  type DocumentRead,
  type IntakeDecision,
  type IntakeDecisionResult,
  type IntakeStatus,
  type IntakeView,
  type InternalIntakeNeedsResponse,
  type InternalIntakeProgressResponse,
  type InternalIntakeRecordResponse,
  type InternalIntakeWithdrawResponse,
  type Need,
  type RecordRefusalReason,
  type RecordValue,
  type StartIntakeRequest,
} from './types'
import { buildIntakeView, intakeCounts } from './view'
import { PRODUCT_NAME } from '@/lib/brand'

const PROFILE_WRITE: readonly ProjectPermission[] = ['project:memory:write', 'project:edit']

export const STALE_READING_AFTER_MS = 30 * 60 * 1000

export const MAX_WRITE_ATTEMPTS = 3

const definition = projectIntakeDefinitionV1

async function requireIntake(organizationId: string, projectId: string): Promise<ProjectIntakeRow> {
  const row = await findProjectIntake(organizationId, projectId)
  if (!row) throw new NotFoundError('This project has no intake.')
  return row
}

async function loadProfile(organizationId: string, projectId: string): Promise<ProjectProfile> {
  const state = await findProjectProfileInOrg(projectId, organizationId)
  if (!state) throw new NotFoundError()
  return salvageProjectProfile(state.profile).profile ?? emptyProjectProfile()
}

async function requireProject(organizationId: string, projectId: string) {
  const project = await findProjectInOrg(projectId, organizationId)
  if (!project) throw new NotFoundError()
  return project
}

async function readableDocuments(organizationId: string, projectId: string): Promise<ExtractableDocument[]> {
  const project = await requireProject(organizationId, projectId)
  return withTenant({ organizationId }, () => extractableDocuments(organizationId, projectId, project.collectionName))
}

export function contentKeyOf(document: Pick<ExtractableDocument, 'contentHash' | 'updatedAt'>): string {
  return document.contentHash ?? `updated:${document.updatedAt.toISOString()}`
}

export function unreadDocuments(documents: readonly ExtractableDocument[], read: readonly DocumentRead[]): ExtractableDocument[] {
  const seen = new Set(read.map((entry) => `${entry.documentId}\u0000${entry.contentHash}`))
  return documents.filter((document) => !seen.has(`${document.documentId}\u0000${contentKeyOf(document)}`))
}

const needsOf = (profile: ProjectProfile, row: ProjectIntakeRow, records: Awaited<ReturnType<typeof readSetupRecords>>): Need[] => computeNeeds(profile, definition, { mode: row.mode, dismissed: row.dismissed, records })

async function holds(
  session: AuthorizedSession,
  projectId: string,
  permission: ProjectPermission | readonly ProjectPermission[]
): Promise<boolean> {
  try {
    await requireProjectAccess(session, projectId, permission)
    return true
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ForbiddenError) return false
    throw error
  }
}

async function requireProfileWriter(session: AuthorizedSession, projectId: string): Promise<void> {
  try {
    await requireProjectAccess(session, projectId, PROFILE_WRITE)
  } catch (error) {
    if (!isProjectClosedError(error)) throw error
    throw new ConflictError('This project is closed. Reopen it to read its documents again.', {
      reason: PROJECT_CLOSED_REASON,
    })
  }
}

async function tellRequester(ended: ProjectIntakeRow): Promise<void> {
  if (!ended.requestedBy || (ended.status !== 'ready' && ended.status !== 'failed')) return
  try {
    const project = await findProjectInOrg(ended.projectId, ended.organizationId)
    const decisiveOpen =
      ended.status === 'ready'
        ? needsOf(await loadProfile(ended.organizationId, ended.projectId), ended, await readSetupRecords(ended.organizationId)).filter(
            (need) => need.decisive && need.state === 'open'
          ).length
        : 0
    await onIntakeReady({
      organizationId: ended.organizationId,
      projectId: ended.projectId,
      intakeId: ended.id,
      recipientUserId: ended.requestedBy,
      projectName: project?.name ?? null,
      outcome: ended.status,
      decisiveOpen,
      summary: null,
    })
  } catch (error) {
    console.warn(`[project-intake] the requester of ${ended.projectId}'s reading could not be told:`, error)
  }
}

const staleReading = () =>
  new ConflictError('This reading is no longer the intake’s current one.', { reason: STALE_READING_REASON })

const intakeCompleted = () =>
  new ConflictError('The review of this intake was finished.', { reason: 'intake-completed' })

async function viewOf(session: AuthorizedSession, row: ProjectIntakeRow): Promise<IntakeView> {
  const { organizationId } = session
  const [profile, documents, canDecide, canManage, applicableLaw, records] = await Promise.all([
    loadProfile(organizationId, row.projectId),
    readableDocuments(organizationId, row.projectId),
    holds(session, row.projectId, PROFILE_WRITE),
    row.mode === 'closing' ? holds(session, row.projectId, 'project:manage') : Promise.resolve(false),
    projectLawFor(organizationId, row.projectId), readSetupRecords(organizationId),
  ])
  const unread = unreadDocuments(documents, row.documentsRead)
  return buildIntakeView({
    row, profile, definition, applicableLaw,
    needs: needsOf(profile, row, records), records,
    unreadDocuments: unread.length,
    readingDocuments: { readable: documents, unread },
    canDecide,
    canComplete: row.status !== 'completed' && (row.mode === 'closing' ? canManage : canDecide),
  })
}

async function reconcileStaleReading(row: ProjectIntakeRow, now: Date): Promise<ProjectIntakeRow> {
  if (row.status !== 'reading' || !row.jobId || !row.startedAt) return row
  if (now.getTime() - new Date(row.startedAt).getTime() < STALE_READING_AFTER_MS) return row
  let outcome: Awaited<ReturnType<typeof fetchBackendJobOutcome>>
  try {
    outcome = await fetchBackendJobOutcome(row.jobId, row.organizationId)
  } catch (error) {
    if (error instanceof JobProbeError) return row
    throw error
  }
  if (outcome && (outcome.status === 'submitted' || outcome.status === 'running')) return row
  const status = outcome?.status === 'success' ? 'ready' : 'failed'
  const ended = await endIntakeReading(row.organizationId, row.projectId, row.jobId, { status, now })
  if (ended) await tellRequester(ended)
  return ended ?? (await requireIntake(row.organizationId, row.projectId))
}

export async function getIntakeView(session: AuthorizedSession, projectId: string): Promise<IntakeView> {
  await requireProjectAccess(session, projectId, 'project:view')
  const row = await reconcileStaleReading(await requireIntake(session.organizationId, projectId), new Date())
  return viewOf(session, row)
}

async function beginReading(
  session: AuthorizedSession,
  projectId: string,
  scope: StartIntakeRequest['scope'],
  trigger: IntakeTrigger
): Promise<ProjectIntakeRow> {
  const { organizationId } = session
  const project = await requireProject(organizationId, projectId)
  const jobId = mintIntakeJobId()
  const now = new Date()
  const claimed = await claimIntakeReading(organizationId, projectId, {
    jobId,
    requestedBy: session.userId,
    forgetRead: scope === 'all',
    now,
  })
  if (!claimed) {
    const rerun = await requestIntakeRerun(organizationId, projectId)
    return rerun ?? (await requireIntake(organizationId, projectId))
  }
  try {
    const submitted = await submitIntakeRun({
      organizationId,
      projectId,
      userId: session.userId,
      email: session.email || null,
      collectionName: project.collectionName,
      jobId,
      scope,
      trigger,
    })
    if (submitted !== jobId) console.warn(`[project-intake] the backend ran ${jobId} as ${submitted}`)
    return claimed
  } catch (error) {
    const ended = await endIntakeReading(organizationId, projectId, jobId, { status: 'failed', now: new Date() })
    if (ended) await tellRequester(ended)
    console.error(`[project-intake] submitting the reading of ${projectId} failed:`, error)
    throw new ServiceUnavailableError(PRODUCT_NAME + ' could not start reading the documents. Try again in a moment.', {
      reason: 'submit-failed',
    })
  }
}

async function startReading(
  session: AuthorizedSession,
  projectId: string,
  scope: StartIntakeRequest['scope'],
  trigger: IntakeTrigger
): Promise<ProjectIntakeRow> {
  await requireProfileWriter(session, projectId)
  const row = await requireIntake(session.organizationId, projectId)
  if (row.status === 'completed') throw intakeCompleted()
  if (row.status === 'reading') {
    return (await requestIntakeRerun(session.organizationId, projectId)) ?? (await requireIntake(session.organizationId, projectId))
  }
  return beginReading(session, projectId, scope, trigger)
}

export async function startIntakeRun(
  session: AuthorizedSession,
  projectId: string,
  body: StartIntakeRequest,
  trigger: IntakeTrigger = 'click'
): Promise<IntakeView> {
  return viewOf(session, await startReading(session, projectId, body.scope, trigger))
}

export async function runIntakeReadSlice<TPayload extends { projectId: string }>(
  session: AuthorizedSession,
  payload: TPayload
): Promise<{ done: true; payload: TPayload }> {
  try {
    await startReading(session, payload.projectId, 'new', 'upload')
  } catch (error) {
    const refused = error instanceof NotFoundError || error instanceof ForbiddenError || error instanceof ConflictError
    if (!refused) throw error
    console.warn(`[project-intake] no reading of ${payload.projectId} for ${session.userId}:`, error.message)
  }
  return { done: true, payload }
}

async function writeProfile<TPlan>(
  session: AuthorizedSession,
  projectId: string,
  plan: (profile: ProjectProfile) => { value: TPlan; before: ProjectProfile; after: ProjectProfile; keys: string[] }
): Promise<TPlan> {
  for (let attempt = 1; ; attempt += 1) {
    const profile = await loadProfile(session.organizationId, projectId)
    const planned = plan(profile)
    const operations = patchForKeys(planned.before, planned.after, planned.keys)
    if (operations.length === 0) return planned.value
    try {
      await patchProjectProfile(session, projectId, operations)
      return planned.value
    } catch (error) {
      if (!(error instanceof ConflictError) || attempt >= MAX_WRITE_ATTEMPTS) throw error
    }
  }
}

function scoreDecisions(
  row: ProjectIntakeRow,
  session: AuthorizedSession,
  scored: ReturnType<typeof planDecisions>['scored']
): Promise<unknown> {
  if (!row.traceId || scored.length === 0) return Promise.resolve()
  const reading = row.jobId ?? row.id
  return Promise.all(
    scored.map((entry) =>
      recordDecisionScore({
        organizationId: row.organizationId,
        subject: 'intake_suggestion',
        subjectId:
          entry.alternativeIndex === null ? `${reading}-${entry.key}` : `${reading}-${entry.key}-${entry.alternativeIndex}`,
        decision: entry.decision,
        decidedBy: session.userId,
        traceId: row.traceId,
      })
    )
  )
}

export async function applyIntakeDecisions(
  session: AuthorizedSession,
  projectId: string,
  sentDecisions: readonly IntakeDecision[]
): Promise<{ results: IntakeDecisionResult[]; intake: IntakeView }> {
  const decisions = sentDecisions.map((decision) =>
    decision.action === 'answer'
      ? { ...decision, key: normalizeProfileKey(decision.key), value: normalizeProfileValue(decision.key, decision.value) }
      : { ...decision, key: normalizeProfileKey(decision.key) }
  )
  await requireProfileWriter(session, projectId)
  const row = await requireIntake(session.organizationId, projectId)
  const plan = await writeProfile(session, projectId, (profile) => {
    const planned = planDecisions(profile, decisions, { userId: session.userId, now: new Date().toISOString() })
    return { value: planned, before: profile, after: planned.profile, keys: planned.changedKeys }
  })
  const updated = plan.dismissed.length > 0 ? await addIntakeDismissed(session.organizationId, projectId, plan.dismissed) : null
  await scoreDecisions(row, session, plan.scored)
  return { results: plan.results, intake: await viewOf(session, updated ?? row) }
}

export async function completeIntake(session: AuthorizedSession, projectId: string, request?: Request): Promise<IntakeView> {
  await requireProjectAccess(session, projectId, 'project:view')
  const row = await requireIntake(session.organizationId, projectId)
  if (row.status === 'completed') return viewOf(session, row)
  if (row.mode === 'closing' && row.closing) {
    await setProjectStatus(session, projectId, {
      status: 'closed',
      outcome: row.closing.outcome,
      endedOn: row.closing.endedOn,
    }, request)
  } else {
    await requireProfileWriter(session, projectId)
  }
  const completed = await completeProjectIntake(session.organizationId, projectId, session.userId, new Date())
  await onIntakeCompleted({ organizationId: session.organizationId, intakeId: row.id })
  return viewOf(session, completed ?? (await requireIntake(session.organizationId, projectId)))
}

async function requireCurrentReading(session: AuthorizedSession, projectId: string, jobId: string): Promise<ProjectIntakeRow> {
  await requireProjectAccess(session, projectId, 'project:view')
  const row = await findProjectIntake(session.organizationId, projectId)
  if (!row) throw new NotFoundError('This project has no intake.')
  if (row.status !== 'reading' || row.jobId !== jobId) throw staleReading()
  return row
}

export async function intakeNeeds(
  session: AuthorizedSession,
  projectId: string,
  jobId: string
): Promise<InternalIntakeNeedsResponse> {
  const row = await requireCurrentReading(session, projectId, jobId)
  const [profile, documents, records] = await Promise.all([
    loadProfile(session.organizationId, projectId),
    readableDocuments(session.organizationId, projectId),
    readSetupRecords(session.organizationId),
  ])
  const unread = [...new Set(unreadDocuments(documents, row.documentsRead).map((document) => document.fileName))]
  return {
    needs: needsOf(profile, row, records).slice(0, MAX_INTAKE_NEEDS),
    unreadFiles: unread.slice(0, MAX_UNREAD_FILES),
    description: row.description ?? null,
    location: row.location ?? null, mode: row.mode,
    previousSummary: row.summary ?? null,
    setupPublished: !setupUnpublished(profile, records),
  }
}

async function screenValues(
  organizationId: string,
  row: ProjectIntakeRow,
  values: readonly RecordValue[],
  readableFiles: ReadonlySet<string>
): Promise<Array<{ key: string; screened: ScreenedValue | null; refusal: RecordRefusalReason | null }>> {
  return Promise.all(
    values.map(async (value) => {
      const refusal = staticRefusal(value, { definition, dismissed: row.dismissed, readableFiles })
      if (refusal) return { key: value.key, screened: null, refusal }
      const evidence = await documentEvidence(value.evidence, { organizationId })
      return { key: value.key, screened: { key: value.key, value: value.value, evidence, reason: reasonFromEvidence(evidence) }, refusal: null }
    })
  )
}

export async function recordIntakeValues(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
  sentValues: readonly RecordValue[]
): Promise<InternalIntakeRecordResponse> {
  const { organizationId } = session
  const values = sentValues.map((value) => ({
    ...value,
    key: normalizeProfileKey(value.key),
    value: normalizeProfileValue(value.key, value.value),
  }))
  const row = await requireCurrentReading(session, projectId, jobId)
  const [documents, lawWithheld, records] = await Promise.all([readableDocuments(organizationId, projectId), lawWithheldAt(organizationId, projectId), readSetupRecords(organizationId)])
  const readableFiles = new Set(documents.map((document) => document.fileName))
  const screened = await screenValues(organizationId, row, values, readableFiles)
  return writeProfile(session, projectId, (current) => {
    const plan = planRecord(current, definition, screened, { now: new Date().toISOString(), readingId: jobId, needs: { mode: row.mode, dismissed: row.dismissed, records }, lawWithheld, records })
    const value = { results: plan.results, opened: plan.opened.slice(0, MAX_INTAKE_NEEDS) }
    return { value, before: current, after: plan.profile, keys: plan.changedKeys }
  })
}

export async function withdrawIntakeValues(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
  sentKeys: readonly string[]
): Promise<InternalIntakeWithdrawResponse> {
  const keys = sentKeys.map(normalizeProfileKey)
  await requireCurrentReading(session, projectId, jobId)
  const [lawWithheld, records] = await Promise.all([lawWithheldAt(session.organizationId, projectId), readSetupRecords(session.organizationId)])
  const results = await writeProfile(session, projectId, (current) => {
    const plan = planWithdraw(current, definition, keys, { now: new Date().toISOString(), readingId: jobId, lawWithheld, records })
    return { value: plan.results, before: current, after: plan.profile, keys: plan.changedKeys }
  })
  return { results }
}

export async function reportIntakeProgress(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
  filesOpened: readonly string[]
): Promise<InternalIntakeProgressResponse> {
  await requireCurrentReading(session, projectId, jobId)
  const names = [...new Set(filesOpened.map((name) => name.trim()).filter(Boolean))].slice(0, MAX_DOCUMENTS_READ)
  const stored = await setIntakeReadingFiles(session.organizationId, projectId, jobId, names)
  if (!stored) throw staleReading()
  return { filesOpened: stored.readingFiles.length }
}

export function mergeDocumentsRead(
  previous: readonly DocumentRead[],
  documents: readonly ExtractableDocument[],
  fileNames: readonly string[]
): DocumentRead[] {
  const named = new Set(fileNames)
  const merged = new Map(previous.map((entry) => [entry.documentId, entry]))
  for (const document of documents) {
    if (named.has(document.fileName)) {
      merged.set(document.documentId, { documentId: document.documentId, contentHash: contentKeyOf(document) })
    }
  }
  return [...merged.values()]
}

export async function finishIntakeReading(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
  input: { summary: string; documentsRead: readonly string[]; traceId: string | null }
): Promise<{ status: IntakeStatus }> {
  const { organizationId } = session
  const row = await requireCurrentReading(session, projectId, jobId)
  const [profile, documents, project, records] = await Promise.all([
    loadProfile(organizationId, projectId),
    readableDocuments(organizationId, projectId),
    requireProject(organizationId, projectId),
    readSetupRecords(organizationId),
  ])
  const documentsRead = mergeDocumentsRead(row.documentsRead, documents, input.documentsRead)
  const needs = needsOf(profile, row, records)
  const counts = intakeCounts(profile, definition, needs, documentsRead.length)
  const summary = input.summary.trim() ? (await maskAnswerText(organizationId, input.summary.trim())).text : null
  const ended = await endIntakeReading(organizationId, projectId, jobId, {
    status: 'ready',
    now: new Date(),
    documentsRead,
    counts,
    summary,
    traceId: input.traceId,
  })
  if (!ended) throw staleReading()
  await onIntakeReady({
    organizationId,
    projectId,
    intakeId: ended.id,
    recipientUserId: ended.requestedBy ?? session.userId,
    projectName: project.name,
    outcome: 'ready',
    decisiveOpen: counts.decisiveOpen,
    summary,
  })
  if (!ended.rerunRequested) return { status: ended.status }
  try {
    return { status: (await beginReading(session, projectId, 'new', 'upload')).status }
  } catch (error) {
    console.warn(`[project-intake] the rerun of ${projectId} could not start; the next upload or a click starts it:`, error)
    return { status: (await requireIntake(organizationId, projectId)).status }
  }
}

export async function settleIntakeOutcome(
  organizationId: string,
  jobId: string,
  status: 'success' | 'failure' | 'interrupted'
): Promise<ProjectIntakeRow | null> {
  const row = await findProjectIntakeByJobId(organizationId, jobId)
  if (!row) return null
  if (row.status !== 'reading') return row
  const ended = await endIntakeReading(organizationId, row.projectId, jobId, {
    status: status === 'success' ? 'ready' : 'failed',
    now: new Date(),
  })
  if (ended) await tellRequester(ended)
  if (ended?.rerunRequested && ended.requestedBy) {
    await enqueueIntakeRead(organizationId, ended.projectId, ended.requestedBy).catch((error: unknown) =>
      console.warn(`[project-intake] the rerun of ${ended.projectId} could not be queued:`, error)
    )
  }
  return ended ?? row
}
