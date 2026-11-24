import 'server-only'
import type { BudgetScope } from '@/lib/db/schema/budgets'
import { canManageBudgets } from '@/lib/authz/organizations'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBudgetStatus } from './budget-status'

export interface ConnectionDiagnostics {
  budgetExhausted: boolean
  blockedScope: BudgetScope | null
  canManageBudgets: boolean
}

export async function getConnectionDiagnostics(
  session: AuthorizedSession,
  requested: { projectId?: string } = {},
): Promise<ConnectionDiagnostics> {
  const status = await getBudgetStatus(session.organizationId, session.userId, requested.projectId ?? null)
  return {
    budgetExhausted: status.blocked,
    blockedScope: status.blockedScope,
    canManageBudgets: canManageBudgets(session),
  }
}
