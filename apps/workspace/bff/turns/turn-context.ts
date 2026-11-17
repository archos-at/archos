import 'server-only'
import type { UserSession } from '@/lib/auth/types'
import { buildCollectionScopeFromRequest } from '@/lib/retrieval-scope/collection-scope-request'
import { loadProjectFederalState } from '@/lib/project-profile/prompt-view'
import { isMemoryReflectionEnabled } from '@/lib/workos/feature-flags'
import { isWebSearchEnabledForOrg } from '@/lib/organizations/service'
import { getEffectiveModelOverrides } from '@/lib/model-config/service'
import { getBudgetStatus } from '@/lib/budgets/service'
import { announceBudgetBlocked } from '@/lib/budgets/budget-events'
import type { ScopedCollection } from '@/lib/retrieval-scope/collection-scope'
import { requesterOf, type RequestPerson } from '@/lib/request-context'

async function bestEffort<T>(what: string, load: () => Promise<T>): Promise<T | null> {
  try {
    return await load()
  } catch (error) {
    console.warn(`[Turn Context] Failed to ${what}:`, error)
    return null
  }
}

export interface TurnBudget {
  remainingOrgUsd: number | null
  remainingUserUsd: number | null
  remainingProjectUsd: number | null
  remainingOrgTokens: number | null
  remainingUserTokens: number | null
  remainingProjectTokens: number | null
}

export interface TurnContext {
  scope: string[]
  scopedCollections: ScopedCollection[]
  header: string
  conversationId?: string
  organizationId?: string | null
  userId?: string | null
  accessToken?: string | null
  projectId?: string
  federalState?: string
  memoryReflectionEnabled: boolean
  disabledSources?: string[]
  modelOverrides?: Record<string, string>
  budget?: TurnBudget
  requester?: RequestPerson
}

export class TurnBudgetExhaustedError extends Error {
  constructor(readonly blockedScope: string | null) {
    super(
      `The ${blockedScope} LLM budget is exhausted. An org admin can raise limits under Organization → Usage & budgets.`
    )
    this.name = 'TurnBudgetExhaustedError'
  }
}

export async function resolveTurnContext(
  session: UserSession | null,
  request: { projectId?: string; conversationId?: string }
): Promise<TurnContext> {
  const { projectId, conversationId } = request
  const {
    scope,
    scopedCollections,
    headerValue,
    projectId: authorizedProjectId,
  } = await buildCollectionScopeFromRequest(session, {
    projectId,
    conversationId,
    interactiveChat: true,
  })

  const context: Omit<TurnContext, 'memoryReflectionEnabled'> & { memoryReflectionEnabled?: boolean } = {
    scope,
    scopedCollections,
    header: headerValue,
  }
  if (conversationId) context.conversationId = conversationId
  if (session) {
    context.organizationId = session.organizationId
    context.userId = session.userId
    context.accessToken = session.accessToken
    const requester = requesterOf(session)
    if (requester) context.requester = requester
  }

  const organizationId = session?.organizationId
  const effectiveProjectId = authorizedProjectId ?? projectId

  const memoryReflectionEnabled = await isMemoryReflectionEnabled(organizationId)
  const budgetStatus =
    organizationId && session
      ? await bestEffort('compute budget status', () =>
          getBudgetStatus(organizationId, session.userId, effectiveProjectId ?? null)
        )
      : null

  if (budgetStatus?.blocked) {
    if (organizationId && session && budgetStatus.blockedScope) {
      void announceBudgetBlocked({
        organizationId,
        userId: session.userId,
        userRole: session.role,
        projectId: effectiveProjectId ?? null,
        scope: budgetStatus.blockedScope,
        unit: budgetStatus.unit,
      })
    }
    throw new TurnBudgetExhaustedError(budgetStatus.blockedScope ?? null)
  }

  const webSearchEnabled = organizationId
    ? await bestEffort('resolve web-search setting', () => isWebSearchEnabledForOrg(organizationId))
    : null
  const modelOverrides = organizationId
    ? await bestEffort('load model overrides', () => getEffectiveModelOverrides(organizationId))
    : null
  const federalState = effectiveProjectId
    ? await bestEffort('load federal-state fact', () => loadProjectFederalState(effectiveProjectId, organizationId))
    : null

  context.memoryReflectionEnabled = memoryReflectionEnabled
  if (organizationId) {
    if (webSearchEnabled === false) context.disabledSources = ['web_search']
    if (modelOverrides) context.modelOverrides = modelOverrides
    if (budgetStatus) {
      context.budget = {
        remainingOrgUsd: budgetStatus.remainingOrgUsd,
        remainingUserUsd: budgetStatus.remainingUserUsd,
        remainingProjectUsd: budgetStatus.remainingProjectUsd,
        remainingOrgTokens: budgetStatus.remainingOrgTokens,
        remainingUserTokens: budgetStatus.remainingUserTokens,
        remainingProjectTokens: budgetStatus.remainingProjectTokens,
      }
    }
  }

  if (effectiveProjectId) {
    context.projectId = effectiveProjectId
    if (federalState) context.federalState = federalState
  }
  return { ...context, memoryReflectionEnabled }
}
