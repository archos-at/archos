/**
 * The one submission of a background run to the research worker: build the
 * payload, sign the requester's envelope (ADR-0108), submit.
 *
 * Two callers. `submitAgentRun` (`./service.ts`) submits a scheduled or
 * delegated run, with its `task_runs` row, its thread and its skill. The
 * project intake (`lib/project-intake/run.ts`, ADR-0111) submits a reading
 * with an agent of its own, no run row and no thread, scoped to the project's
 * main collection. Both sign the envelope from the same
 * `runRequestContextInput`, so a tool in either run acts as the requester the
 * way a tool on a chat turn does.
 *
 * Kept apart from `./service.ts` so a caller that is not a definition (the
 * intake) does not import the definitions' service and everything behind it.
 */

import 'server-only'
import { knowledgeContextForTurn } from '@/lib/base-knowledge/context/service'
import { isTemporaryConversation } from '@/lib/conversations/temporary'
import type { JobOutput } from '@/lib/db/schema/jobs'
import { buildRequestContextWireHeaders, encodeBudgetHeader } from '@/lib/request-context'
import type { PlanDocuments } from '@/lib/runs/plan-documents'
import { submitJob, type JobPriority, type JobSubmitPayload, type BackgroundAgentType } from './backend-client'
import { runRequestContextInput, warnIfRunEnvelopeLarge, type RunContext, type RunSubject } from './run-context'

export interface BackgroundRunSubmission {
  /** Who the run acts as, and where. */
  subject: RunSubject
  ownerEmail: string | null
  /** The prompt exactly as it is submitted. */
  prompt: string
  /** The attached skills' names, for the worker's log. */
  skills: string[]
  output: JobOutput
  /** An agent of its own instead of the output kind's (`project_intake`). */
  agentType?: BackgroundAgentType
  /** The backend job id to use, when the caller stamps it on a row before submitting. */
  jobId?: string
  /** The `task_runs` row this job is; absent for a run without one (the intake). */
  runId?: string
  /** The thread the run writes into, signed into the envelope; null for none. */
  conversationId: string | null
  clarifierResult?: string | null
  documents?: PlanDocuments | null
  /** As the backend should receive them: null means every source available to the agent. */
  dataSources: string[] | null
  priority: JobPriority
  /** The run's context as of now (`resolveRunContext`), shaped by the caller. */
  context: RunContext
}

/**
 * Submit one background run. Returns the backend's job id and whether it was
 * queued. Throws what `submitJob` throws (`JobSubmitError`,
 * `JobSubmitSkippedError`).
 */
export async function submitBackgroundRun(run: BackgroundRunSubmission): Promise<{ jobId: string; queued: boolean }> {
  const { subject, context, conversationId } = run
  const budgetHeader = context.budget ? encodeBudgetHeader(context.budget) : null
  // A run is no chat turn and never calls the turn context, so it carries the
  // law of its project itself (ADR-0175): its knowledge context, chain text
  // included. It never throws: a read that fails is the gate's
  // `knowledge_unavailable`, so the run fails closed and is still submitted.
  // Its failed read is the run's, never the turn alert's (ADR-0173).
  const knowledgeContext = await knowledgeContextForTurn(subject.organizationId, subject.projectId, undefined, null, 'run')
  // A temporary conversation keeps nothing (ADR-0180 rule 2): said at submit, so
  // the worker skips its reflection before paying for the model call. A failed
  // read does not stop the run: the memory routes' refusal holds either way,
  // as it does for a conversation switched to temporary after this.
  const temporary = await isTemporaryConversation(conversationId, subject.organizationId).catch(() => false)

  const payload: JobSubmitPayload = {
    input: run.prompt,
    skills: run.skills,
    output: run.output,
    ...(run.agentType ? { agent_type: run.agentType } : {}),
    ...(run.jobId ? { job_id: run.jobId } : {}),
    ...(conversationId ? { conversation_id: conversationId } : {}),
    // The run this job is, so the worker folds its ledger onto the run's own
    // message instead of narrating into the void (ADR-0062).
    ...(run.runId ? { run_id: run.runId } : {}),
    ...(run.clarifierResult ? { clarifier_result: run.clarifierResult } : {}),
    ...(run.documents ? { documents: run.documents } : {}),
    data_sources: run.dataSources,
    collection_scope: context.collectionScope,
    project_context: context.projectContext,
    project_memory: context.projectMemory,
    memory_reflection_enabled: context.memoryReflectionEnabled,
    ...(temporary ? { temporary_conversation: true } : {}),
    organization_id: subject.organizationId,
    user_id: subject.userId,
    project_id: subject.projectId,
    owner_email: run.ownerEmail,
    budget_header: budgetHeader,
    model_overrides: context.modelOverrides,
    priority: run.priority,
    knowledge_context: knowledgeContext,
  }

  // The worker keeps this envelope with the job and echoes it to the BFF from
  // the run's tools, so a background run acts as the person who commissioned it
  // (ADR-0108). It therefore carries what a chat turn's envelope carries for
  // those tools: the thread the run writes into, and `issuedAt`. Past the
  // renewal age the worker asks `POST /api/internal/runs/[runId]/envelope`
  // for a fresh one, signed from the same `runRequestContextInput`.
  const contextHeaders = buildRequestContextWireHeaders(
    runRequestContextInput(subject, context, conversationId, Date.now()),
    process.env.INTERNAL_API_TOKEN,
  )
  warnIfRunEnvelopeLarge(contextHeaders, run.runId ?? run.jobId ?? subject.projectId)

  return submitJob(payload, contextHeaders)
}
