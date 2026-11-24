import 'server-only'
import { randomUUID } from 'node:crypto'
import { submitBackgroundRun } from '@/lib/jobs/background-run'
import type { JobPriority } from '@/lib/jobs/backend-client'
import { resolveRunContext, type RunContext } from '@/lib/jobs/run-context'
import { ingestBudgetSnapshot } from '@/lib/budgets/ingest-allowance'

export const INTAKE_AGENT_TYPE = 'project_intake'

export type IntakeTrigger = 'upload' | 'click'

export interface IntakeRunInput {
  organizationId: string
  projectId: string
  userId: string
  email: string | null
  collectionName: string
  jobId: string
  scope: 'new' | 'all'
  trigger: IntakeTrigger
}

export function mintIntakeJobId(): string {
  return `intake-${randomUUID()}`
}

export function intakeInstruction(scope: IntakeRunInput['scope'], trigger: IntakeTrigger): string {
  const what =
    scope === 'all'
      ? "Read every document of the project's main collection again."
      : "Read the documents of the project's main collection that have not been read yet."
  const why = trigger === 'upload' ? 'New documents were uploaded.' : 'A person asked for a reading.'
  return `${why} ${what}`
}

export function intakeRunContext(context: RunContext, collectionName: string): RunContext {
  return {
    ...context,
    collectionScope: [collectionName],
    projectContext: null,
    projectMemory: null,
    orgInstructions: null,
    memoryReflectionEnabled: false,
  }
}

const PRIORITY: Record<IntakeTrigger, JobPriority> = { upload: 'bulk', click: 'interactive' }

export async function submitIntakeRun(input: IntakeRunInput): Promise<string> {
  const subject = { organizationId: input.organizationId, projectId: input.projectId, userId: input.userId }
  const prompt = intakeInstruction(input.scope, input.trigger)
  const resolved = intakeRunContext(await resolveRunContext(subject, prompt), input.collectionName)
  const context =
    input.trigger === 'upload' ? { ...resolved, budget: await ingestBudgetSnapshot(input.organizationId) } : resolved
  const { jobId } = await submitBackgroundRun({
    subject,
    ownerEmail: input.email,
    prompt,
    skills: [],
    output: 'chat',
    agentType: INTAKE_AGENT_TYPE,
    jobId: input.jobId,
    conversationId: null,
    dataSources: null,
    priority: PRIORITY[input.trigger],
    context,
  })
  return jobId
}
