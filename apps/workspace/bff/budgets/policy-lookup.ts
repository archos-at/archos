import 'server-only'
import type { BudgetPolicy, BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageBudgets } from '@/lib/authz/organizations'
import { isOrgOnOwnKey } from '@/lib/llm-credentials/service'
import { getEffectivePricing } from '@/lib/pricing/service'
import * as repository from './repository'

export async function getOrgBudgetUnit(organizationId: string): Promise<BudgetUnit> {
  return (await isOrgOnOwnKey(organizationId)) ? 'token' : 'credit'
}

export interface BudgetLimits {
  unit: BudgetUnit
  dailyLimit: number | null
  monthlyLimit: number | null
}

export interface EffectiveBudgetPolicy extends BudgetLimits {
  scope: BudgetScope
  subjectId: string | null
  explicit: boolean
  policy: BudgetPolicy | null
}

function toLimits(policy: BudgetPolicy): BudgetLimits {
  return {
    unit: policy.currency,
    dailyLimit: policy.dailyLimit === null ? null : Number.parseFloat(policy.dailyLimit),
    monthlyLimit: policy.monthlyLimit === null ? null : Number.parseFloat(policy.monthlyLimit),
  }
}

export async function getOrgBudget(organizationId: string, unit?: BudgetUnit): Promise<EffectiveBudgetPolicy> {
  const resolvedUnit = unit ?? (await getOrgBudgetUnit(organizationId))
  const policy = await repository.findActivePolicy(organizationId, 'organization', null, resolvedUnit)
  if (policy) {
    return { scope: 'organization', subjectId: null, explicit: true, policy, ...toLimits(policy) }
  }
  if (resolvedUnit === 'token') {
    return { scope: 'organization', subjectId: null, explicit: false, policy: null, unit: 'token', dailyLimit: null, monthlyLimit: null }
  }
  const pricing = await getEffectivePricing()
  return {
    scope: 'organization',
    subjectId: null,
    explicit: false,
    policy: null,
    unit: 'credit',
    dailyLimit: pricing.defaultOrgDailyCredits,
    monthlyLimit: pricing.defaultOrgMonthlyCredits,
  }
}

export async function getScopedBudget(
  organizationId: string,
  scope: 'member' | 'project',
  subjectId: string,
  unit?: BudgetUnit,
): Promise<EffectiveBudgetPolicy | null> {
  const resolvedUnit = unit ?? (await getOrgBudgetUnit(organizationId))
  const policy = await repository.findActivePolicy(organizationId, scope, subjectId, resolvedUnit)
  if (!policy) return null
  return { scope, subjectId, explicit: true, policy, ...toLimits(policy) }
}

export async function listActivePolicies(organizationId: string, unit?: BudgetUnit): Promise<BudgetPolicy[]> {
  return repository.listActivePolicies(organizationId, unit ?? (await getOrgBudgetUnit(organizationId)))
}

export async function listPolicyHistory(organizationId: string, limit = 100): Promise<BudgetPolicy[]> {
  return repository.listPolicyHistory(organizationId, limit)
}

export interface BudgetOverview {
  unit: BudgetUnit
  organization: EffectiveBudgetPolicy
  ownMemberLimit: EffectiveBudgetPolicy | null
  policies?: BudgetPolicy[]
}

export async function getBudgetOverview(session: AuthorizedSession): Promise<BudgetOverview> {
  const unit = await getOrgBudgetUnit(session.organizationId)
  const [organization, ownMemberLimit] = await Promise.all([
    getOrgBudget(session.organizationId, unit),
    getScopedBudget(session.organizationId, 'member', session.userId, unit),
  ])
  const overview: BudgetOverview = { unit, organization, ownMemberLimit }
  if (canManageBudgets(session)) {
    overview.policies = await listActivePolicies(session.organizationId, unit)
  }
  return overview
}
