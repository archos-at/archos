import 'server-only'
import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { canManageBudgets } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getOrgBudget, getOrgBudgetUnit, getScopedBudget, type BudgetLimits } from './policy-lookup'
import { getBudgetStatus } from './budget-status'
import { getSpendSummary } from './spend-queries'
import { toTenantWindow, type TenantSpendWindow } from './spend-windows'

export interface ProjectUsage {
  unit: BudgetUnit
  day: TenantSpendWindow
  month: TenantSpendWindow
  perModel: Array<{ model: string; month: TenantSpendWindow }>
  projectLimit: BudgetLimits | null
  orgLimit: BudgetLimits
  blockedScope: BudgetScope | null
}

export async function getProjectUsage(
  session: AuthorizedSession,
  projectId: string,
): Promise<ProjectUsage> {
  if (!canManageBudgets(session)) {
    await requireProjectAccess(session, projectId, 'project:manage')
  } else {
    await requireProjectAccess(session, projectId, 'project:view')
  }

  const unit = await getOrgBudgetUnit(session.organizationId)
  const project = toTenantWindow(unit)

  const [summary, orgBudget, projectBudget, status] = await Promise.all([
    getSpendSummary(session.organizationId, { projectId }),
    getOrgBudget(session.organizationId, unit),
    getScopedBudget(session.organizationId, 'project', projectId, unit),
    getBudgetStatus(session.organizationId, null, projectId),
  ])

  const limits = (policy: BudgetLimits): BudgetLimits => ({
    unit: policy.unit,
    dailyLimit: policy.dailyLimit,
    monthlyLimit: policy.monthlyLimit,
  })

  return {
    unit,
    day: project(summary.day),
    month: project(summary.month),
    perModel: summary.perModel
      .map((entry) => ({ model: entry.model, month: project(entry.month) }))
      .filter((entry) => entry.month.events > 0)
      .sort((a, b) => b.month.amount - a.month.amount),
    projectLimit: projectBudget ? limits(projectBudget) : null,
    orgLimit: limits(orgBudget),
    blockedScope: status.blockedScope,
  }
}
