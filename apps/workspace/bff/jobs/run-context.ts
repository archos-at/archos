import 'server-only'
import { resolvePerson } from '@/lib/auth/person'
import { getBudgetStatus } from '@/lib/budgets/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { resolveRunConversationContext } from '@/lib/conversation-context/resolve'
import { getEffectiveModelOverrides } from '@/lib/model-config/service'
import { resolveOrgInstructions } from '@/lib/org-instructions/service'
import { loadProjectFederalState, loadProjectPromptView } from '@/lib/project-profile/prompt-view'
import { buildProjectMemoryDigest } from '@/lib/projects/memory-service'
import { requesterOf, type BudgetSnapshot, type RequestContextInput } from '@/lib/request-context'
import { isMemoryReflectionEnabled } from '@/lib/workos/feature-flags'

export interface RunSubject {
  organizationId: string
  projectId: string
  userId: string
}

export type RunDecision =
  | { kind: 'run'; session: AuthorizedSession; conversationId?: string | null }
  | { kind: 'headless'; session: null }

export async function resolveRunContext(
  { organizationId, projectId, userId }: RunSubject,
  prompt: string,
  decision: RunDecision,
) {
  const [
    budget,
    modelOverrides,
    decided,
    projectContext,
    federalState,
    projectMemory,
    memoryReflectionEnabled,
    orgInstructions,
    requester,
  ] = await Promise.all([
    resolveBudgetSnapshot(organizationId, userId, projectId),
    getEffectiveModelOverrides(organizationId).catch(() => null),
    decision.session
      ? resolveRunConversationContext(decision.session, { projectId, conversationId: decision.conversationId, kind: decision.kind })
      : null,
    loadProjectPromptView(projectId, organizationId).catch(() => null),
    loadProjectFederalState(projectId, organizationId).catch(() => null),
    buildProjectMemoryDigest(projectId, organizationId, { query: prompt }).catch(() => null),
    isMemoryReflectionEnabled(organizationId).catch(() => false),
    resolveOrgInstructions(organizationId),
    resolvePerson(organizationId, userId),
  ])
  const shelves = decided?.may.shelves.map((entry) => entry.collection) ?? []
  return {
    kind: decision.kind,
    conversationId: decided?.conversationId ?? null,
    collectionScope: shelves.length > 0 ? shelves : null,
    budget,
    modelOverrides,
    projectContext,
    federalState: federalState,
    projectMemory,
    memoryReflectionEnabled,
    orgInstructions,
    requester: requesterOf(requester),
  }
}

export type RunContext = Awaited<ReturnType<typeof resolveRunContext>>

export function runRequestContextInput(
  subject: RunSubject,
  context: RunContext,
  issuedAt: number,
): RequestContextInput {
  return {
    organizationId: subject.organizationId,
    userId: subject.userId,
    projectId: subject.projectId,
    collectionScope: context.collectionScope,
    projectContext: context.projectContext,
    projectMemory: context.projectMemory,
    orgInstructions: context.orgInstructions,
    modelOverrides: context.modelOverrides,
    budget: context.budget,
    federalState: context.federalState,
    memoryReflectionEnabled: context.memoryReflectionEnabled,
    conversationId: context.conversationId,
    issuedAt,
    requester: context.requester,
    contextKind: context.kind,
  }
}

async function resolveBudgetSnapshot(
  organizationId: string,
  userId: string,
  projectId: string,
): Promise<BudgetSnapshot | null> {
  try {
    const status = await getBudgetStatus(organizationId, userId, projectId)
    return {
      remainingOrgUsd: status.remainingOrgUsd,
      remainingUserUsd: status.remainingUserUsd,
      remainingProjectUsd: status.remainingProjectUsd,
      remainingOrgTokens: status.remainingOrgTokens,
      remainingUserTokens: status.remainingUserTokens,
      remainingProjectTokens: status.remainingProjectTokens,
    }
  } catch {
    return null
  }
}

export const RUN_ENVELOPE_WARN_BYTES = 12 * 1024

export function warnIfRunEnvelopeLarge(headers: Record<string, string> | string | undefined, runId: string): void {
  if (!headers) return
  const bytes =
    typeof headers === 'string'
      ? headers.length
      : Object.entries(headers).reduce((sum, [name, value]) => sum + name.length + String(value ?? '').length, 0)
  if (bytes > RUN_ENVELOPE_WARN_BYTES) {
    console.warn(
      `[runs] run ${runId}: its request context headers are ${bytes} bytes; ` +
        `past ${RUN_ENVELOPE_WARN_BYTES} they near the 16 KB header limit its tools' calls must stay under`
    )
  }
}
