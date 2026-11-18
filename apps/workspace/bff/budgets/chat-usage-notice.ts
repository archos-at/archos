import 'server-only'
import { can } from '@/lib/authz/decide'
import { canManageBudgets } from '@/lib/authz/organizations'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBudgetUtilisation } from './budget-utilisation'
import { decideUsageNotice, type ChatUsageNotice } from './usage-notice'

export async function getChatUsageNotice(
  session: AuthorizedSession,
  requested: { projectId?: string } = {},
  now: Date = new Date(),
): Promise<ChatUsageNotice | null> {
  const projectId =
    requested.projectId && (await can(session, 'project:view', { type: 'project', id: requested.projectId }))
      ? requested.projectId
      : null
  const decision = decideUsageNotice(await getBudgetUtilisation(session.organizationId, session.userId, projectId), now)
  if (!decision) return null

  const budgetAdmin = canManageBudgets(session)
  const projectAdmin =
    decision.scope === 'project' && projectId && !budgetAdmin
      ? await can(session, 'project:manage', { type: 'project', id: projectId })
      : false
  const canChange = budgetAdmin || projectAdmin
  const href =
    decision.scope === 'project' && projectId && canChange
      ? `/app/projects/${encodeURIComponent(projectId)}/settings/usage`
      : '/app/organization/budgets'
  const showAmounts = canChange || decision.scope === 'member'

  return {
    level: decision.level,
    scope: decision.scope,
    window: decision.window,
    unit: decision.unit,
    percent: decision.percent,
    amounts: showAmounts ? { used: decision.used, limit: decision.limit } : null,
    resetsAt: decision.resetsAt,
    runsOutAt: decision.runsOutAt,
    canChange,
    href,
    key: [decision.scope, decision.scope === 'project' ? projectId : '', decision.window, decision.windowId, decision.level].join(':'),
  }
}
