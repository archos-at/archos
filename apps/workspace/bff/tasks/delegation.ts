import 'server-only'

import { ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { JobOutput } from '@/lib/db/schema/jobs'
import type { NewTaskDefinition, TaskDefinition, TaskRun } from '@/lib/db/schema/task-model'
import type { DelegatableTaskKind, TaskPlan } from '@/lib/db/schema/task-model'
import { DELEGATABLE_TASK_KINDS } from '@/lib/db/schema/task-model'
import { createTaskThread, submitAgentRun } from '@/lib/jobs/service'
import { JobSubmitError, JobSubmitSkippedError } from '@/lib/jobs/backend-client'
import { minIntervalMinutesFromEnv, nextOccurrence, validateCron } from '@/lib/jobs/schedule'
import { syncScheduledRun } from '@/lib/scheduling/scheduled-runs'
import { AGENT_RUN_INPUT_MAX_CHARS, emptySkillSnapshot } from '@/lib/jobs/types'
import { formatCount } from '@/lib/format'
import { isEmptyPlanDocuments, type PlanDocuments } from '@/lib/runs/plan-documents'
import {
  AGENT_REFUSAL_LOCALE,
  requireMayLeaveConversation,
  requirePlanDocumentsOpen,
} from '@/lib/conversations/restricted-egress'
import type { Locale } from '@/i18n/config'
import * as repository from './repository'
import { recordSubmission } from './run-moves'
import { submittedRunStatus } from './task-vocabulary'
import { TASK_GOAL_MAX_CHARS } from './wire'
import { PRODUCT_NAME } from '@/lib/brand'

export { TASK_GOAL_MAX_CHARS }

export const COMMISSION_PERMISSIONS = ['project:edit', 'project:documents:write'] as const

interface TaskEngine {
  readonly instruction: (goal: string) => string
  readonly title: (goal: string) => string
}

const TASK_ENGINES: Record<DelegatableTaskKind, TaskEngine> = {
  compliance_check: {
    instruction: (goal) =>
      [
        "Run a norm check for this project against the regulation corpus and the project's documents,",
        'and work the result into an answer that says, for each point, what is met,',
        'what is open and what it depends on. Name the source of every finding.',
        '',
        'The request, verbatim:',
        goal,
      ].join('\n'),
    title: (goal) => `Normprüfung: ${goal}`,
  },
  submission_check: {
    instruction: (goal) =>
      [
        'Prüfe die Vollständigkeit der Einreichung für dieses Projekt — /submission-check.',
        '',
        'Der Auftrag, wörtlich:',
        goal,
      ].join('\n'),
    title: (goal) => `Einreichcheck: ${goal}`,
  },
  document: {
    instruction: (goal) =>
      [
        'Schreibe das beauftragte Dokument VOLLSTÄNDIG als deine Antwort, in Markdown,',
        'mit einer Überschrift (`# …`) am Anfang. Die Antwort IST das Dokument: keine',
        'Zusammenfassung davor, keine Rückfrage, kein „ich könnte".',
        PRODUCT_NAME + ' legt es danach als ENTWURF im Projekt ab und legt es zur Freigabe vor —',
        'behaupte nicht, es sei freigegeben.',
        '',
        'Der Auftrag, wörtlich:',
        goal,
      ].join('\n'),
    title: (goal) => `Dokument: ${goal}`,
  },
  revision: {
    instruction: (goal) =>
      [
        'Eine Person hat einen Entwurf zurückgegeben. Überarbeite ihn nach dem, was sie',
        'geschrieben hat, und gib das ÜBERARBEITETE DOKUMENT vollständig als deine',
        'Antwort aus, in Markdown, mit Überschrift. Die Antwort IST die neue Fassung:',
        'keine Liste der Änderungen, kein Kommentar davor.',
        PRODUCT_NAME + ' macht daraus die nächste Version desselben Dokuments und legt sie wieder',
        'zur Freigabe vor.',
        '',
        'Der Auftrag, wörtlich:',
        goal,
      ].join('\n'),
    title: (goal) => `Überarbeitung: ${goal}`,
  },
}

export function isDelegatableTaskKind(value: string): value is DelegatableTaskKind {
  return (DELEGATABLE_TASK_KINDS as readonly string[]).includes(value)
}

export interface DelegateTaskCadence {
  cron: string
  timezone?: string
}

export interface DelegateTaskInput {
  projectId: string
  kind: DelegatableTaskKind
  goal: string
  dueAt?: Date | null
  cadence?: DelegateTaskCadence | null
  subject?: TaskPlan['subject']
  sourceText?: string | null
  requester?: { userId: string; email: string | null }
  conversationId?: string | null
  locale?: Locale
}

export interface DelegateTaskResult {
  definition: TaskDefinition
  run: TaskRun | null
}

export async function delegateTask(
  session: AuthorizedSession,
  input: DelegateTaskInput,
): Promise<DelegateTaskResult> {
  await requireProjectAccess(session, input.projectId, [...COMMISSION_PERMISSIONS])
  await requireMayLeaveConversation(
    {
      conversationId: input.conversationId ?? null,
      locale: input.locale ?? AGENT_REFUSAL_LOCALE,
    },
    session.organizationId,
    'task',
  )

  const goal = input.goal.trim()
  if (!goal) throw new UnprocessableError('A task needs a goal')
  if (goal.length > TASK_GOAL_MAX_CHARS) {
    throw new UnprocessableError(`A goal is at most ${TASK_GOAL_MAX_CHARS} characters`)
  }
  if (input.kind === 'revision' && !input.subject) {
    throw new UnprocessableError('A revision task needs the version it is revising')
  }
  if (input.cadence && input.dueAt) {
    throw new UnprocessableError('A task is either one-off (due) or recurring (cadence), never both')
  }

  if (input.cadence) {
    try {
      await requireProjectAccess(session, input.projectId, 'project:skills:manage')
    } catch (error) {
      if (error instanceof ForbiddenError || error instanceof NotFoundError) {
        throw new ForbiddenError(
          'Für wiederkehrende Aufträge fehlt die Berechtigung project:skills:manage.',
        )
      }
      throw error
    }
  }

  const engine = TASK_ENGINES[input.kind]
  const instruction = engine.instruction(goal)
  const source = quoteSource(instruction, input.sourceText)
  const prompt = source.block ? `${instruction}${PROMPT_SEPARATOR}${source.block}` : instruction
  if (source.refusal && input.cadence) throw new UnprocessableError(source.refusal)
  const requester = input.requester ?? { userId: session.userId, email: session.email }
  const title = engine.title(goal).slice(0, 200)

  const cadenceTimezone = input.cadence?.timezone ?? 'UTC'
  if (input.cadence) {
    validateCron(input.cadence.cron, cadenceTimezone, minIntervalMinutesFromEnv())
  }
  const nextRunAt = input.cadence
    ? nextOccurrence(input.cadence.cron, cadenceTimezone, new Date())
    : null

  const definitionValues: NewTaskDefinition = {
    organizationId: session.organizationId,
    projectId: input.projectId,
    kind: input.kind,
    title,
    plan: {
      prompt,
      skill: emptySkillSnapshot(),
      dataSources: null,
      goal,
      subject: input.subject ?? null,
    },
    requesterUserId: requester.userId,
    requesterEmail: requester.email,
    trigger: input.cadence ? 'schedule' : 'once',
    enabled: true,
    scheduleCron: input.cadence?.cron ?? null,
    scheduleTimezone: cadenceTimezone,
    nextRunAt,
    dueAt: input.cadence ? null : (input.dueAt ?? null),
  }

  if (input.cadence) {
    const definition = await repository.insertDefinition(definitionValues)
    await syncScheduledRun(definition)
    await recordAuditEvent({
      organizationId: session.organizationId,
      actor: { userId: session.userId, email: session.email },
      action: 'task.created',
      targetType: 'task',
      targetId: definition.id,
      metadata: { projectId: input.projectId, kind: input.kind, trigger: 'schedule' },
    })
    return { definition, run: null }
  }

  const { definition, run } = await repository.insertDefinitionWithRun(definitionValues, {
    organizationId: session.organizationId,
    projectId: input.projectId,
    kind: input.kind,
    title,
    plan: definitionValues.plan,
    requesterUserId: requester.userId,
    requesterEmail: requester.email,
    trigger: 'delegated',
    triggeredBy: session.userId,
    status: 'queued',
    skillSnapshot: emptySkillSnapshot(),
  })

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'task.created',
    targetType: 'task',
    targetId: run.id,
    metadata: { projectId: input.projectId, kind: input.kind, trigger: 'delegated' },
  })

  if (source.refusal) {
    return {
      definition,
      run: await recordFailedRun(run, source.refusal),
    }
  }
  return { definition, run: await dispatchRun(definition, run, input.conversationId ?? null) }
}

export interface CommissionResearchInput {
  projectId: string
  conversationId: string
  question: string
  context?: string | null
  dataSources?: string[] | null
  documents?: PlanDocuments | null
  locale?: Locale
}

export interface CommissionedResearchRun {
  runId: string
  runMessageId: string | null
  conversationId: string
  status: TaskRun['status']
}

export async function commissionResearchRun(
  session: AuthorizedSession,
  input: CommissionResearchInput,
): Promise<CommissionedResearchRun> {
  await requireProjectAccess(session, input.projectId, [...COMMISSION_PERMISSIONS])
  await requireMayLeaveConversation(
    {
      conversationId: input.conversationId,
      locale: input.locale ?? AGENT_REFUSAL_LOCALE,
    },
    session.organizationId,
    'deepResearch',
  )
  const documents = input.documents ?? null
  if (documents) {
    await requirePlanDocumentsOpen(
      session.organizationId,
      input.projectId,
      [...documents.basis, ...documents.excluded],
      input.locale ?? AGENT_REFUSAL_LOCALE,
    )
  }

  const question = input.question.trim()
  if (!question) throw new UnprocessableError('A research run needs a question')
  if (question.length > TASK_GOAL_MAX_CHARS) {
    throw new UnprocessableError(`A question is at most ${TASK_GOAL_MAX_CHARS} characters`)
  }

  const context = input.context?.trim()
  const plan: TaskPlan = {
    prompt: context ? `${question}\n\n${CONTEXT_HEADING}\n${context}` : question,
    skill: emptySkillSnapshot(),
    dataSources: input.dataSources ?? null,
    goal: question,
    subject: null,
    ...(context ? { context } : {}),
    ...(documents && !isEmptyPlanDocuments(documents) ? { documents } : {}),
  }
  const queued = await repository.insertRun({
    organizationId: session.organizationId,
    projectId: input.projectId,
    definitionId: null,
    kind: 'deep-research',
    title: researchTitle(question),
    plan,
    requesterUserId: session.userId,
    requesterEmail: session.email,
    trigger: 'delegated',
    triggeredBy: session.userId,
    status: 'queued',
    skillSnapshot: emptySkillSnapshot(),
  })

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'task.created',
    targetType: 'task',
    targetId: queued.id,
    metadata: { projectId: input.projectId, kind: 'deep-research', trigger: 'delegated' },
  })

  const run = await submitQueuedRun(queued, {
    thread: () => Promise.resolve(input.conversationId),
    output: 'deep-research',
  })
  return {
    runId: run.id,
    runMessageId: run.runMessageId,
    conversationId: run.conversationId ?? input.conversationId,
    status: run.status,
  }
}

const CONTEXT_HEADING = 'Was in der Unterhaltung bereits geklärt wurde:'

function researchTitle(question: string): string {
  const firstSentence = question.split(/(?<=[.?!])\s/)[0]?.trim() || question
  const shown = firstSentence.length > 0 ? firstSentence : question
  return shown.length > 200 ? `${shown.slice(0, 199).trimEnd()}…` : shown
}

async function dispatchRun(
  definition: TaskDefinition,
  run: TaskRun,
  originConversationId: string | null,
): Promise<TaskRun> {
  return submitQueuedRun(run, {
    thread: () => (originConversationId ? Promise.resolve(originConversationId) : createTaskThread(definition)),
    output: 'chat',
  })
}

interface DispatchTarget {
  thread: () => Promise<string | null>
  output: JobOutput
}

async function submitQueuedRun(run: TaskRun, target: DispatchTarget): Promise<TaskRun> {
  let submitted: Awaited<ReturnType<typeof submitAgentRun>>
  try {
    const conversation = await target.thread()
    submitted = await submitAgentRun({
      organizationId: run.organizationId,
      projectId: run.projectId,
      userId: run.requesterUserId,
      ownerEmail: run.requesterEmail,
      title: run.title,
      prompt: run.plan.prompt,
      skillSnapshot: run.skillSnapshot.name ? run.skillSnapshot : null,
      output: target.output,
      dataSources: run.plan.dataSources,
      runId: run.id,
      conversationId: conversation,
      clarifierResult: run.plan.context ?? null,
      documents: run.plan.documents ?? null,
    })
  } catch (error) {
    const detail =
      error instanceof JobSubmitSkippedError || error instanceof JobSubmitError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'Unexpected error while preparing the run'
    console.error('[runs] could not submit run', run.id, error)
    return recordFailedRun(run, detail.slice(0, 2000))
  }
  const { backendJobId, conversationId, runMessageId } = submitted
  const submission = { status: submittedRunStatus(submitted), backendJobId, conversationId, runMessageId }
  try {
    return (await recordSubmission(run.id, run.organizationId, submission)) ?? run
  } catch (error) {
    console.error('[runs] could not record run', run.id, submission.status, backendJobId, error)
    return { ...run, ...submission, startedAt: submission.status === 'running' ? new Date() : null }
  }
}

async function recordFailedRun(run: TaskRun, error: string): Promise<TaskRun> {
  try {
    const closed = await repository.closeActiveRun(run.id, run.organizationId, { status: 'failed', error })
    return closed ?? (await repository.findRunById(run.id)) ?? run
  } catch (cause) {
    console.error('[runs] could not record run', run.id, 'failed', cause)
    return { ...run, status: 'failed', error, finishedAt: new Date() }
  }
}

const PROMPT_SEPARATOR = '\n\n'

interface QuotedSource {
  block: string
  refusal: string | null
}

function quoteSource(instruction: string, text: string | null | undefined): QuotedSource {
  const body = (text ?? '').trim()
  if (!body) return { block: '', refusal: null }
  const block = ['Die bisherige Fassung, wörtlich:', '', '```markdown', body, '```'].join('\n')
  const room = AGENT_RUN_INPUT_MAX_CHARS - instruction.length - PROMPT_SEPARATOR.length
  if (block.length <= room) return { block, refusal: null }
  const budget = Math.max(0, room - (block.length - body.length))
  return { block: '', refusal: tooLongToRevise(body.length, budget) }
}

function tooLongToRevise(length: number, budget: number): string {
  return [
    `Das Dokument ist mit ${formatCount(length, 'de-AT')} Zeichen zu lang für einen Überarbeitungsauftrag`,
    `(höchstens ${formatCount(budget, 'de-AT')} Zeichen). Die zurückgegebene Fassung bleibt unverändert;`,
    'über „Mit ' + PRODUCT_NAME + ' besprechen“ am Dokument lässt sie sich abschnittsweise überarbeiten.',
  ].join(' ')
}
