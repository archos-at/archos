import 'server-only'
import { ApiError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { AuthorizedSession } from '@/lib/auth/types'
import { CHAT_PERMISSIONS } from '@/lib/authz/chat'
import { FEATURE_FLAGS, type KnownFeatureFlag } from '@/lib/authz/feature-flags'
import { requireProjectAccess } from '@/lib/authz/projects'
import { authorizeConversationScope } from '@/lib/retrieval-scope/collection-scope-request'
import type { TaskRun } from '@/lib/db/schema/task-model'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import { isUuid } from '@/lib/ids'
import { resolveRunContext, runRequestContextInput, warnIfRunEnvelopeLarge } from '@/lib/jobs/run-context'
import { buildRequestContextEnvelope } from '@/lib/request-context'
import * as taskRepository from '@/lib/tasks/repository'
import { isActiveTaskRunStatus } from '@/lib/tasks/task-vocabulary'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import type { RunEnvelopeRefusal, RunEnvelopeResponse } from './run-envelope-types'

export type RunEnvelopeOutcome =
  | { ok: true; envelope: RunEnvelopeResponse }
  | { ok: false; refusal: RunEnvelopeRefusal; message: string }

export const RUN_ENVELOPE_REFUSAL_STATUS: Readonly<Record<RunEnvelopeRefusal, number>> = {
  'unknown-run': 404,
  'run-not-active': 409,
  'requester-may-not-act': 403,
}

function refuse(refusal: RunEnvelopeRefusal, message: string): RunEnvelopeOutcome {
  return { ok: false, refusal, message }
}

export function capabilityOf(run: Pick<TaskRun, 'trigger' | 'kind' | 'definitionId'>): KnownFeatureFlag {
  if (run.trigger !== 'delegated') return FEATURE_FLAGS.skills
  if (run.kind === 'deep-research' && run.definitionId === null) return FEATURE_FLAGS.deepResearch
  return FEATURE_FLAGS.taskAutomation
}

function isRefusal(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 403 || error.status === 404)
}

async function mayChatInProject(session: AuthorizedSession, projectId: string): Promise<boolean> {
  try {
    const access = await requireProjectAccess(session, projectId, CHAT_PERMISSIONS)
    return !access.readsBecauseClosed
  } catch (error) {
    if (isRefusal(error)) return false
    throw error
  }
}

async function signableConversation(
  session: AuthorizedSession,
  conversationId: string | null,
): Promise<string | null | 'refused'> {
  if (!conversationId) return null
  try {
    return (await authorizeConversationScope(session, conversationId)) ? conversationId : null
  } catch (error) {
    if (isRefusal(error)) return 'refused'
    throw error
  }
}

export async function renewRunEnvelope(runId: string, now: number = Date.now()): Promise<RunEnvelopeOutcome> {
  if (!isUuid(runId)) return refuse('unknown-run', 'Unknown run')
  const run = await withPlatformAccess(
    'run envelope: the worker names a run by id, before any organization is known',
    () => taskRepository.findRunById(runId),
  )
  if (!run) return refuse('unknown-run', 'Unknown run')
  if (!isActiveTaskRunStatus(run.status)) return refuse('run-not-active', 'This run has already ended')

  return withTenant({ organizationId: run.organizationId, userId: run.requesterUserId }, () => signFor(run, now))
}

async function signFor(run: TaskRun, now: number): Promise<RunEnvelopeOutcome> {
  const session = await resolvePinnedRequesterSession({
    userId: run.requesterUserId,
    email: run.requesterEmail,
    organizationId: run.organizationId,
  })
  if (!session) return refuse('requester-may-not-act', 'The requester is no longer a member of the organization')
  if (!(await isOrgFeatureEnabled(capabilityOf(run), run.organizationId))) {
    return refuse('requester-may-not-act', 'The organization no longer has this capability')
  }
  if (!(await mayChatInProject(session, run.projectId))) {
    return refuse('requester-may-not-act', 'The requester may no longer work in this project')
  }
  const conversationId = await signableConversation(session, run.conversationId)
  if (conversationId === 'refused') {
    return refuse('requester-may-not-act', 'The requester may no longer view the run’s conversation')
  }

  const subject = { organizationId: run.organizationId, projectId: run.projectId, userId: run.requesterUserId }
  const context = await resolveRunContext(subject, run.plan.prompt)
  const { header, signature } = buildRequestContextEnvelope(
    runRequestContextInput(subject, context, conversationId, now),
    process.env.INTERNAL_API_TOKEN,
  )
  if (!signature) throw new Error('INTERNAL_API_TOKEN is not configured; cannot sign a run envelope')
  warnIfRunEnvelopeLarge({ envelope: header, signature }, run.id)

  await recordAuditEvent({
    organizationId: run.organizationId,
    actor: { userId: run.requesterUserId, email: run.requesterEmail },
    action: 'task.envelope_renewed',
    targetType: 'task',
    targetId: run.id,
    metadata: { projectId: run.projectId, kind: run.kind, trigger: run.trigger },
  })
  return { ok: true, envelope: { header, signature, issuedAt: now } }
}
