import 'server-only'
import { resolvePerson } from '@/lib/auth/person'
import { getBudgetStatus } from '@/lib/budgets/service'
import { computeCollectionScope } from '@/lib/retrieval-scope/collection-scope'
import { getEffectiveModelOverrides } from '@/lib/model-config/service'
import { resolveOrgInstructions } from '@/lib/org-instructions/service'
import { loadProjectFederalState, loadProjectPromptView } from '@/lib/project-profile/prompt-view'
import { buildProjectMemoryDigest } from '@/lib/projects/memory-service'
import { findProjectInOrg } from '@/lib/projects/repository'
import { requesterOf, type BudgetSnapshot, type RequestContextInput } from '@/lib/request-context'
import { isMemoryReflectionEnabled } from '@/lib/workos/feature-flags'

export interface RunSubject {
  organizationId: string
  projectId: string
  userId: string
}

export async function resolveRunContext({ organizationId, projectId, userId }: RunSubject, prompt: string) {
  const [
    budget,
    modelOverrides,
    collectionScope,
    projectContext,
    federalState,
    projectMemory,
    memoryReflectionEnabled,
    orgInstructions,
    requester,
  ] = await Promise.all([
    resolveBudgetSnapshot(organizationId, userId, projectId),
    getEffectiveModelOverrides(organizationId).catch(() => null),
    buildProjectCollectionScope(projectId, organizationId),
    loadProjectPromptView(projectId, organizationId).catch(() => null),
    loadProjectFederalState(projectId, organizationId).catch(() => null),
    buildProjectMemoryDigest(projectId, organizationId, { query: prompt }).catch(() => null),
    isMemoryReflectionEnabled(organizationId).catch(() => false),
    resolveOrgInstructions(organizationId),
    resolvePerson(organizationId, userId),
  ])
  return {
    budget,
    modelOverrides,
    collectionScope,
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
  conversationId: string | null,
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
    conversationId,
    issuedAt,
    requester: context.requester,
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

async function buildProjectCollectionScope(
  projectId: string,
  organizationId: string,
): Promise<string[] | null> {
  const project = await findProjectInOrg(projectId, organizationId)
  const scope = computeCollectionScope(null, {
    projectId,
    projectCollectionName: project?.collectionName,
    includeProject: true,
  })
  return scope.length > 0 ? scope : null
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
