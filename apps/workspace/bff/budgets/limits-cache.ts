import 'server-only'
import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { getCached, invalidateCached, invalidateCachedPrefix } from '@/lib/cache'
import { getOrgBudget, getScopedBudget, type BudgetLimits } from './policy-lookup'

const LIMITS_CACHE_TTL_MS = 5 * 60 * 1000

const limitsCacheKey = (organizationId: string, unit: BudgetUnit, scope: BudgetScope, subjectId: string | null): string =>
  `budgetlimits:${organizationId}:${unit}:${scope}:${subjectId ?? ''}`

export async function getCachedOrgLimits(organizationId: string, unit: BudgetUnit): Promise<BudgetLimits> {
  return getCached(limitsCacheKey(organizationId, unit, 'organization', null), LIMITS_CACHE_TTL_MS, async () => {
    const org = await getOrgBudget(organizationId, unit)
    return { unit: org.unit, dailyLimit: org.dailyLimit, monthlyLimit: org.monthlyLimit }
  })
}

export async function getCachedScopedLimits(
  organizationId: string,
  unit: BudgetUnit,
  scope: 'member' | 'project',
  subjectId: string,
): Promise<BudgetLimits | null> {
  return getCached(limitsCacheKey(organizationId, unit, scope, subjectId), LIMITS_CACHE_TTL_MS, async () => {
    const scoped = await getScopedBudget(organizationId, scope, subjectId, unit)
    if (!scoped) return null
    return { unit: scoped.unit, dailyLimit: scoped.dailyLimit, monthlyLimit: scoped.monthlyLimit }
  })
}

export async function invalidateLimitsCache(
  organizationId: string,
  scope: BudgetScope,
  subjectId: string | null,
): Promise<void> {
  await Promise.all(
    (['credit', 'token'] as const).map((unit) => invalidateCached(limitsCacheKey(organizationId, unit, scope, subjectId))),
  )
}

export async function invalidateSeededLimits(): Promise<void> {
  await invalidateCachedPrefix('budgetlimits:')
}
