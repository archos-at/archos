import 'server-only'
import { randomUUID } from 'node:crypto'
import { captureServer } from '@/lib/analytics/posthog-server'
import { requireProjectAccess } from '@/lib/authz/projects'
import { FEATURE_FLAGS, requireSkillsEnabled } from '@/lib/authz/feature-flags'
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/api/errors'
import { insertConversation } from '@/lib/conversations/repository'
import { findProjectInOrg } from '@/lib/projects/repository'
import { isProjectClosed, runsOnSchedule, SCHEDULE_SKIPPED_BECAUSE } from '@/lib/projects/project-status'
import type { PlanDocuments } from '@/lib/runs/plan-documents'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { submitBackgroundRun } from './background-run'
import { resolveRunContext } from './run-context'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { JobOutput } from '@/lib/db/schema/jobs'
import type { DefinitionTrigger, TaskDefinition, TaskRun, TaskRunTrigger } from '@/lib/db/schema/task-model'
import { resolveSkillSnapshot } from '@/lib/skills/service'
import { snapshotOf, type SkillSnapshot } from '@/lib/skills/types'
import { nextOccurrence, validateCron, validateDueAt, minIntervalMinutesFromEnv } from './schedule'
import { JobSubmitError, JobSubmitSkippedError, type JobPriority } from './backend-client'
import * as repository from '@/lib/tasks/repository'
import { dropScheduledRun, syncScheduledRun } from '@/lib/scheduling/scheduled-runs'
import { requireMaySeeSubject } from '@/lib/tasks/subject-access'
import { decodeCursorParam, previousDecisionsBlock, toTaskRunViews } from '@/lib/tasks/service'
import type { TaskListQuery, TaskPage, TaskRunView, TaskView } from '@/lib/tasks/task-wire'
import { encodeDocumentListCursor } from '@/lib/documents/list-cursor'
import { taskThreadConversationId } from '@/lib/tasks/task-thread'
import { isActiveTaskRunStatus, submittedRunStatus } from '@/lib/tasks/task-vocabulary'
import { createRunMessage } from '@/lib/runs/service'
import {
  AGENT_RUN_INPUT_MAX_CHARS,
  emptySkillSnapshot,
  withAlwaysOnSources,
  type CreateJobInput,
  type PatchJobInput,
} from './types'

function assertJobsFeatureOn(session: AuthorizedSession): void {
  if (requireSkillsEnabled(session)) {
    throw new ForbiddenError('Tasks are disabled.')
  }
}

function toTaskView(definition: TaskDefinition): TaskView {
  const skill = definition.plan.skill
  return {
    id: definition.id,
    projectId: definition.projectId,
    name: definition.title,
    prompt: definition.plan.prompt,
    skillName: skill && skill.name ? skill.name : null,
    output: definition.kind === 'deep-research' ? 'deep-research' : 'chat',
    dataSources: definition.plan.dataSources,
    enabled: definition.enabled,
    scheduleCron: definition.scheduleCron,
    scheduleTimezone: definition.scheduleTimezone,
    dueAt: definition.dueAt?.toISOString() ?? null,
    nextRunAt: definition.nextRunAt?.toISOString() ?? null,
    lastRunAt: definition.lastRunAt?.toISOString() ?? null,
    createdBy: definition.requesterUserId,
    createdAt: definition.createdAt.toISOString(),
    updatedAt: definition.updatedAt.toISOString(),
  }
}

async function resolveAttachedSkill(
  skillName: string | null | undefined,
  organizationId: string,
): Promise<{ skillName: string | null; skillSnapshot: SkillSnapshot }> {
  if (skillName == null || skillName === '') {
    return { skillName: null, skillSnapshot: emptySkillSnapshot() }
  }
  const snapshot = await resolveSkillSnapshot(skillName, organizationId)
  return { skillName: snapshot.name, skillSnapshot: snapshotOf(snapshot) }
}

function computeNextRunAt(
  scheduleCron: string | null,
  timezone: string,
  enabled: boolean,
): Date | null {
  if (!scheduleCron) return null
  const next = nextOccurrence(scheduleCron, timezone, new Date())
  return enabled ? next : null
}

function resolveScheduleInputs(
  scheduleCron: string | null,
  scheduleTimezone: string,
  dueAt: Date | null,
  enabled: boolean,
): { nextRunAt: Date | null } {
  if (scheduleCron) {
    validateCron(scheduleCron, scheduleTimezone, minIntervalMinutesFromEnv())
    return { nextRunAt: computeNextRunAt(scheduleCron, scheduleTimezone, enabled) }
  }
  if (dueAt) {
    validateDueAt(dueAt)
    return { nextRunAt: enabled ? dueAt : null }
  }
  return { nextRunAt: null }
}

function triggerFor(scheduleCron: string | null, dueAt: Date | null): DefinitionTrigger {
  if (scheduleCron) return 'schedule'
  if (dueAt) return 'once'
  return 'manual'
}

async function requireDefinitionAccess(
  session: AuthorizedSession,
  projectId: string,
  recurring: boolean,
): Promise<void> {
  await requireProjectAccess(session, projectId, 'project:edit')
  if (recurring) {
    await requireProjectAccess(session, projectId, 'project:skills:manage')
  }
}

export async function listJobs(
  session: AuthorizedSession,
  projectId: string,
  query: TaskListQuery,
): Promise<TaskPage> {
  assertJobsFeatureOn(session)
  await requireProjectAccess(session, projectId, 'project:view')
  const page = await repository.listDefinitionPage(projectId, session.organizationId, {
    limit: query.limit,
    cursor: decodeCursorParam(query.cursor),
  })
  return {
    tasks: page.rows.map(toTaskView),
    nextCursor: page.next ? encodeDocumentListCursor(page.next) : null,
  }
}

export async function getJob(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
): Promise<TaskView> {
  assertJobsFeatureOn(session)
  await requireProjectAccess(session, projectId, 'project:view')
  const definition = await repository.findDefinition(jobId, session.organizationId)
  if (!definition || definition.projectId !== projectId) throw new NotFoundError('Task not found.')
  await requireMaySeeSubject(session, projectId, definition, 'Task not found.')
  return toTaskView(definition)
}

export async function createJob(
  session: AuthorizedSession,
  projectId: string,
  input: CreateJobInput,
): Promise<TaskView> {
  assertJobsFeatureOn(session)
  const scheduleCron = input.scheduleCron ?? null
  const dueAt = input.dueAt ?? null
  await requireDefinitionAccess(session, projectId, scheduleCron !== null)

  const scheduleTimezone = input.scheduleTimezone ?? 'UTC'
  const enabled = input.enabled ?? true
  const attached = await resolveAttachedSkill(input.skillName, session.organizationId)
  const { nextRunAt } = resolveScheduleInputs(scheduleCron, scheduleTimezone, dueAt, enabled)

  const definition = await repository.insertDefinition({
    projectId,
    organizationId: session.organizationId,
    kind: 'deep-research',
    title: input.name,
    plan: {
      prompt: input.prompt,
      skill: attached.skillSnapshot,
      dataSources: withAlwaysOnSources(input.dataSources ?? null),
    },
    requesterUserId: session.userId,
    requesterEmail: session.email,
    trigger: triggerFor(scheduleCron, dueAt),
    enabled,
    scheduleCron,
    scheduleTimezone,
    dueAt,
    nextRunAt,
  })
  await syncScheduledRun(definition)
  return toTaskView(definition)
}

export async function updateJob(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
  patch: PatchJobInput,
): Promise<TaskView> {
  assertJobsFeatureOn(session)
  const existing = await repository.findDefinition(jobId, session.organizationId)
  if (!existing || existing.projectId !== projectId) throw new NotFoundError('Task not found.')

  const scheduleCron = patch.scheduleCron !== undefined ? patch.scheduleCron : existing.scheduleCron
  const dueAt = patch.dueAt !== undefined ? patch.dueAt : existing.dueAt
  await requireDefinitionAccess(session, projectId, scheduleCron !== null)

  const scheduleTimezone = patch.scheduleTimezone ?? existing.scheduleTimezone
  const enabled = patch.enabled ?? existing.enabled
  const effectiveDueAt = scheduleCron ? null : dueAt
  const { nextRunAt } = resolveScheduleInputs(
    scheduleCron,
    scheduleTimezone,
    effectiveDueAt,
    enabled,
  )

  let plan = existing.plan
  if (patch.name !== undefined || patch.prompt !== undefined || patch.skillName !== undefined || patch.dataSources !== undefined) {
    const attached =
      patch.skillName === undefined
        ? { skillSnapshot: plan.skill }
        : await resolveAttachedSkill(patch.skillName, session.organizationId)
    plan = {
      ...plan,
      prompt: patch.prompt ?? plan.prompt,
      skill: attached.skillSnapshot,
      dataSources:
        patch.dataSources !== undefined
          ? withAlwaysOnSources(patch.dataSources)
          : plan.dataSources,
    }
  }

  const definition = await repository.updateDefinition(jobId, session.organizationId, {
    title: patch.name,
    plan,
    trigger: triggerFor(scheduleCron, effectiveDueAt),
    enabled,
    scheduleCron,
    scheduleTimezone,
    dueAt: effectiveDueAt,
    nextRunAt,
    updatedAt: new Date(),
  })
  if (!definition) throw new NotFoundError('Task not found.')
  await syncScheduledRun(definition)
  return toTaskView(definition)
}

export async function deleteJob(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
): Promise<{ deleted: true }> {
  assertJobsFeatureOn(session)
  const existing = await repository.findDefinition(jobId, session.organizationId)
  if (!existing || existing.projectId !== projectId) throw new NotFoundError('Task not found.')
  await requireDefinitionAccess(session, projectId, existing.scheduleCron !== null)

  await repository.deleteDefinition(jobId, session.organizationId)
  await dropScheduledRun(existing)
  return { deleted: true }
}

export async function runJobNow(
  session: AuthorizedSession,
  projectId: string,
  jobId: string,
): Promise<{ run: TaskRunView }> {
  assertJobsFeatureOn(session)
  await requireProjectAccess(session, projectId, 'project:skills:manage')

  const definition = await repository.findDefinition(jobId, session.organizationId)
  if (!definition || definition.projectId !== projectId) throw new NotFoundError('Task not found.')
  if (!definition.enabled) throw new ConflictError('This task is disabled.')
  const run = await fireJob(definition, 'manual', session.userId)
  const [view] = await toTaskRunViews(session.organizationId, [run])
  return { run: view }
}

export interface FirePromptInput {
  prompt: string
}

export function buildFirePrompt({ prompt }: FirePromptInput): string {
  return prompt.trim()
}

export interface AgentRunSpec {
  organizationId: string
  projectId: string
  userId: string
  ownerEmail: string | null
  title: string | null
  prompt: string
  skillSnapshot: SkillSnapshot | null
  output: JobOutput
  dataSources: string[] | null
  runId: string
  conversationId: string | null
  clarifierResult?: string | null
  documents?: PlanDocuments | null
  priority?: JobPriority
}

export interface SubmittedAgentRun {
  backendJobId: string
  conversationId: string | null
  runMessageId: string | null
  queued: boolean
}

export async function submitAgentRun(spec: AgentRunSpec): Promise<SubmittedAgentRun> {
  if (spec.prompt.length > AGENT_RUN_INPUT_MAX_CHARS) {
    throw new JobSubmitError(
      `The run's prompt is ${spec.prompt.length} characters; a run accepts at most ${AGENT_RUN_INPUT_MAX_CHARS}`,
      422,
    )
  }
  const { organizationId, projectId, userId } = spec
  const subject = { organizationId, projectId, userId }
  const context = await resolveRunContext(subject, spec.prompt)
  const conversationId = spec.conversationId

  const { jobId, queued } = await submitBackgroundRun({
    subject,
    ownerEmail: spec.ownerEmail,
    prompt: spec.prompt,
    skills: spec.skillSnapshot ? [spec.skillSnapshot.name] : [],
    output: spec.output,
    conversationId,
    runId: spec.runId,
    clarifierResult: spec.clarifierResult,
    documents: spec.documents,
    dataSources: withAlwaysOnSources(spec.dataSources ?? null),
    priority: spec.priority ?? 'interactive',
    context,
  })
  const runMessageId = conversationId
    ? await mintRunMessage(conversationId, spec.runId, spec.title)
    : null
  return { backendJobId: jobId, conversationId, runMessageId, queued }
}

async function mintRunMessage(
  conversationId: string,
  runId: string,
  title: string | null,
): Promise<string | null> {
  try {
    const message = await createRunMessage(conversationId, runId, { title })
    return message.id
  } catch (err) {
    console.warn('[runs] could not create the run message for run', runId, err)
    return null
  }
}

export async function fireJob(
  definition: TaskDefinition,
  trigger: TaskRunTrigger,
  actor: string,
): Promise<TaskRun> {
  const { organizationId, projectId } = definition
  const runId = randomUUID()

  try {
    const decisions = await previousDecisionsBlock(definition)
    const firePrompt = [buildFirePrompt({ prompt: definition.plan.prompt }), decisions]
      .filter(Boolean)
      .join('\n\n')
    const thread = await createTaskThread(definition)
    const submitted = await submitAgentRun({
      organizationId,
      projectId,
      userId: definition.requesterUserId,
      ownerEmail: definition.requesterEmail,
      title: definition.title,
      prompt: firePrompt,
      skillSnapshot: definition.plan.skill.name ? definition.plan.skill : null,
      output: definition.kind === 'deep-research' ? 'deep-research' : 'chat',
      dataSources: definition.plan.dataSources ?? null,
      runId,
      conversationId: thread,
      priority: trigger === 'schedule' ? 'bulk' : 'interactive',
    })
    const { backendJobId, conversationId, runMessageId } = submitted
    return recordRun(definition, trigger, actor, runId, {
      status: submittedRunStatus(submitted),
      backendJobId,
      error: null,
      conversationId,
      runMessageId,
      firePrompt,
    })
  } catch (err) {
    if (err instanceof JobSubmitSkippedError) {
      const detail =
        err.retryAfterSeconds != null
          ? `${err.message} (retry after ${err.retryAfterSeconds}s)`
          : err.message
      return recordRun(definition, trigger, actor, runId, {
        status: 'skipped',
        backendJobId: null,
        error: detail,
        conversationId: null,
      })
    }
    const detail =
      err instanceof JobSubmitError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'Unexpected error while preparing the run'
    return recordRun(definition, trigger, actor, runId, {
      status: 'error',
      backendJobId: null,
      error: detail,
      conversationId: null,
    })
  }
}

interface FireOutcome {
  status: 'queued' | 'running' | 'skipped' | 'error'
  backendJobId: string | null
  error: string | null
  conversationId: string | null
  runMessageId?: string | null
  firePrompt?: string
}

async function recordRun(
  definition: TaskDefinition,
  trigger: TaskRunTrigger,
  actor: string,
  runId: string,
  { status, backendJobId, error, conversationId, runMessageId, firePrompt }: FireOutcome,
): Promise<TaskRun> {
  const run = await repository.insertRun({
    id: runId,
    runMessageId: runMessageId ?? null,
    organizationId: definition.organizationId,
    projectId: definition.projectId,
    definitionId: definition.id,
    kind: definition.kind,
    title: definition.title,
    plan: firePrompt ? { ...definition.plan, prompt: firePrompt } : definition.plan,
    requesterUserId: definition.requesterUserId,
    requesterEmail: definition.requesterEmail,
    trigger,
    triggeredBy: actor,
    status,
    error,
    skillSnapshot: definition.plan.skill.name
      ? definition.plan.skill
      : emptySkillSnapshot(),
    backendJobId,
    conversationId,
    startedAt: status === 'running' ? new Date() : null,
  })
  await repository.touchDefinitionLastRun(definition.id, run.createdAt)
  return run
}

export async function createTaskThread(definition: TaskDefinition): Promise<string | null> {
  const id = taskThreadConversationId(definition.id)

  try {
    await insertConversation({
      id,
      organizationId: definition.organizationId,
      createdBy: definition.requesterUserId,
      title: `Aufgabe: ${definition.title}`,
      projectId: definition.projectId,
      visibility: 'project',
      jobId: definition.id,
    })
    return id
  } catch (err) {
    console.warn('[definitions] failed to create the thread for definition', definition.id, err)
    return null
  }
}

export async function fireScheduledJob(
  definition: TaskDefinition,
): Promise<{
  fired: boolean
  jobId?: string
  reason?: 'disabled' | 'feature-disabled' | 'project-closed' | 'project-paused' | 'skipped' | 'error'
}> {
  if (!definition.enabled) {
    return { fired: false, reason: 'disabled' }
  }
  const project = await findProjectInOrg(definition.projectId, definition.organizationId)
  if (project && !runsOnSchedule(project)) {
    const closed = isProjectClosed(project)
    await recordRun(definition, 'schedule', 'scheduler', randomUUID(), {
      status: 'skipped',
      backendJobId: null,
      error: closed ? SCHEDULE_SKIPPED_BECAUSE.closed : SCHEDULE_SKIPPED_BECAUSE.paused,
      conversationId: null,
    })
    return { fired: false, reason: closed ? 'project-closed' : 'project-paused' }
  }
  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.skills, definition.organizationId))) {
    await recordRun(definition, 'schedule', 'scheduler', randomUUID(), {
      status: 'skipped',
      backendJobId: null,
      error: 'Skills feature disabled for organization',
      conversationId: null,
    })
    return { fired: false, reason: 'feature-disabled' }
  }
  const run = await fireJob(definition, 'schedule', 'scheduler')
  if (isActiveTaskRunStatus(run.status)) {
    captureServer({
      event: 'job_run_started',
      distinctId: null,
      organizationId: definition.organizationId,
      properties: {
        job_id: definition.id,
        run_id: run.id,
        trigger: 'schedule',
        output: definition.kind === 'deep-research' ? 'deep-research' : 'chat',
      },
    })
    return { fired: true, jobId: run.backendJobId ?? undefined }
  }
  return { fired: false, reason: run.status === 'skipped' ? 'skipped' : 'error' }
}
