import 'server-only'
import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { creditsToCostUsd, getEffectivePricing } from '@/lib/pricing/service'
import type { SpendTotals } from './repository'
import { getCachedOrgLimits, getCachedScopedLimits } from './limits-cache'
import { getOrgBudgetUnit, type BudgetLimits } from './policy-lookup'
import { getSpendTotals } from './spend-queries'
import { consumed } from './spend-windows'

export interface BudgetStatus {
  blocked: boolean
  blockedScope: BudgetScope | null
  unit: BudgetUnit
  remainingOrg: number | null
  remainingUser: number | null
  remainingProject: number | null
  remainingOrgUsd: number | null
  remainingUserUsd: number | null
  remainingProjectUsd: number | null
  remainingOrgTokens: number | null
  remainingUserTokens: number | null
  remainingProjectTokens: number | null
}

function remainingIn(limits: BudgetLimits, spend: SpendTotals): number | null {
  const candidates: number[] = []
  if (limits.dailyLimit !== null) candidates.push(limits.dailyLimit - consumed(spend.day, limits.unit))
  if (limits.monthlyLimit !== null) candidates.push(limits.monthlyLimit - consumed(spend.month, limits.unit))
  if (candidates.length === 0) return null
  return Math.max(0, Math.min(...candidates))
}

export async function getBudgetStatus(
  organizationId: string,
  userId: string | null,
  projectId: string | null,
): Promise<BudgetStatus> {
  const unit = await getOrgBudgetUnit(organizationId)
  const [orgBudget, orgSpend, memberBudget, projectBudget, pricing] = await Promise.all([
    getCachedOrgLimits(organizationId, unit),
    getSpendTotals(organizationId),
    userId ? getCachedScopedLimits(organizationId, unit, 'member', userId) : Promise.resolve(null),
    projectId ? getCachedScopedLimits(organizationId, unit, 'project', projectId) : Promise.resolve(null),
    unit === 'credit' ? getEffectivePricing() : Promise.resolve(null),
  ])
  const remainingOrg = remainingIn(orgBudget, orgSpend)

  const [memberSpend, projectSpend] = await Promise.all([
    memberBudget && userId ? getSpendTotals(organizationId, { userId }) : Promise.resolve(null),
    projectBudget && projectId ? getSpendTotals(organizationId, { projectId }) : Promise.resolve(null),
  ])

  const remainingUser = memberBudget && memberSpend ? remainingIn(memberBudget, memberSpend) : null
  const remainingProject = projectBudget && projectSpend ? remainingIn(projectBudget, projectSpend) : null

  const scopes: Array<[BudgetScope, number | null]> = [
    ['organization', remainingOrg],
    ['member', remainingUser],
    ['project', remainingProject],
  ]
  const exhausted = scopes.find(([, remaining]) => remaining !== null && remaining <= 0)

  const toUsd = (credits: number | null): number | null =>
    credits === null || !pricing ? null : creditsToCostUsd(credits, pricing)
  const tokens = (remaining: number | null): number | null => (unit === 'token' ? remaining : null)

  return {
    blocked: Boolean(exhausted),
    blockedScope: exhausted?.[0] ?? null,
    unit,
    remainingOrg,
    remainingUser,
    remainingProject,
    remainingOrgUsd: toUsd(remainingOrg),
    remainingUserUsd: toUsd(remainingUser),
    remainingProjectUsd: toUsd(remainingProject),
    remainingOrgTokens: tokens(remainingOrg),
    remainingUserTokens: tokens(remainingUser),
    remainingProjectTokens: tokens(remainingProject),
  }
}
