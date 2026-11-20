import 'server-only'
import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { getCachedOrgLimits, getCachedScopedLimits } from './limits-cache'
import { getOrgBudgetUnit, type BudgetLimits } from './policy-lookup'
import { getSpendTotals } from './spend-queries'
import { consumed } from './spend-windows'

export interface BudgetUtilisation {
  scope: BudgetScope
  subjectId: string | null
  unit: BudgetUnit
  window: 'day' | 'month'
  limit: number
  used: number
}

export async function getBudgetUtilisation(
  organizationId: string,
  userId: string | null,
  projectId: string | null,
): Promise<BudgetUtilisation[]> {
  const unit = await getOrgBudgetUnit(organizationId)
  const [orgLimits, memberLimits, projectLimits] = await Promise.all([
    getCachedOrgLimits(organizationId, unit),
    userId ? getCachedScopedLimits(organizationId, unit, 'member', userId) : Promise.resolve(null),
    projectId ? getCachedScopedLimits(organizationId, unit, 'project', projectId) : Promise.resolve(null),
  ])
  const targets: Array<{
    scope: BudgetScope
    subjectId: string | null
    limits: BudgetLimits
    filter: { userId?: string; projectId?: string }
  }> = [{ scope: 'organization', subjectId: null, limits: orgLimits, filter: {} }]
  if (memberLimits && userId) targets.push({ scope: 'member', subjectId: userId, limits: memberLimits, filter: { userId } })
  if (projectLimits && projectId) {
    targets.push({ scope: 'project', subjectId: projectId, limits: projectLimits, filter: { projectId } })
  }

  const spends = await Promise.all(targets.map((target) => getSpendTotals(organizationId, target.filter)))
  return targets.flatMap((target, index) => {
    const spend = spends[index]
    if (!spend) return []
    const windows = [
      { window: 'day' as const, limit: target.limits.dailyLimit, used: consumed(spend.day, target.limits.unit) },
      { window: 'month' as const, limit: target.limits.monthlyLimit, used: consumed(spend.month, target.limits.unit) },
    ]
    return windows.flatMap(({ window, limit, used }) =>
      limit === null
        ? []
        : [{ scope: target.scope, subjectId: target.subjectId, unit: target.limits.unit, window, limit, used }],
    )
  })
}
