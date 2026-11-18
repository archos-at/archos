import 'server-only'
import { knowledgeContextForTurn } from '@/lib/base-knowledge/context/service'
import { isTemporaryConversation } from '@/lib/conversations/temporary'
import type { JobOutput } from '@/lib/db/schema/jobs'
import { buildRequestContextWireHeaders, encodeBudgetHeader } from '@/lib/request-context'
import type { PlanDocuments } from '@/lib/runs/plan-documents'
import { submitJob, type JobPriority, type JobSubmitPayload, type BackgroundAgentType } from './backend-client'
import { runRequestContextInput, warnIfRunEnvelopeLarge, type RunContext, type RunSubject } from './run-context'

export interface BackgroundRunSubmission {
  subject: RunSubject
  ownerEmail: string | null
  prompt: string
  skills: string[]
  output: JobOutput
  agentType?: BackgroundAgentType
  jobId?: string
  runId?: string
  conversationId: string | null
  clarifierResult?: string | null
  documents?: PlanDocuments | null
  dataSources: string[] | null
  priority: JobPriority
  context: RunContext
}

export async function submitBackgroundRun(run: BackgroundRunSubmission): Promise<{ jobId: string; queued: boolean }> {
  const { subject, context, conversationId } = run
  const budgetHeader = context.budget ? encodeBudgetHeader(context.budget) : null
  const knowledgeContext = await knowledgeContextForTurn(subject.organizationId, subject.projectId, undefined, null, 'run')
  const temporary = await isTemporaryConversation(conversationId, subject.organizationId).catch(() => false)

  const payload: JobSubmitPayload = {
    input: run.prompt,
    skills: run.skills,
    output: run.output,
    ...(run.agentType ? { agent_type: run.agentType } : {}),
    ...(run.jobId ? { job_id: run.jobId } : {}),
    ...(conversationId ? { conversation_id: conversationId } : {}),
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

  const contextHeaders = buildRequestContextWireHeaders(
    runRequestContextInput(subject, context, conversationId, Date.now()),
    process.env.INTERNAL_API_TOKEN,
  )
  warnIfRunEnvelopeLarge(contextHeaders, run.runId ?? run.jobId ?? subject.projectId)

  return submitJob(payload, contextHeaders)
}
