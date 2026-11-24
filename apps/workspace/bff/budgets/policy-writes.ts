import 'server-only'
import type { BudgetPolicy, BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { ConflictError } from '@/lib/api/errors'
import * as repository from './repository'
import { getOrgBudget, getOrgBudgetUnit } from './policy-lookup'
import { invalidateLimitsCache } from './limits-cache'

export class BudgetValidationError extends Error {}

export async function setBudgetPolicy(params: {
  organizationId: string
  scope: BudgetScope
  subjectId: string | null
  dailyLimit: number | null
  monthlyLimit: number | null
  actorUserId: string
  note?: string | null
  expectedUnit?: BudgetUnit
}): Promise<BudgetPolicy> {
  const { organizationId, scope, subjectId } = params
  if (scope === 'organization' && subjectId !== null) {
    throw new BudgetValidationError('organization scope must not carry a subjectId')
  }
  if (scope !== 'organization' && !subjectId) {
    throw new BudgetValidationError(`${scope} scope requires a subjectId`)
  }
  for (const value of [params.dailyLimit, params.monthlyLimit]) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      throw new BudgetValidationError('limits must be non-negative numbers or null')
    }
  }

  const unit = await getOrgBudgetUnit(organizationId)
  if (params.expectedUnit !== undefined && params.expectedUnit !== unit) {
    throw new ConflictError('Organization budget unit changed; reload before saving')
  }
  if (scope !== 'organization') {
    const org = await getOrgBudget(organizationId, unit)
    const pairs: Array<[number | null, number | null, string]> = [
      [params.dailyLimit, org.dailyLimit, 'daily'],
      [params.monthlyLimit, org.monthlyLimit, 'monthly'],
    ]
    for (const [scoped, orgLimit, window] of pairs) {
      if (orgLimit === null) continue
      if (scoped === null) {
        throw new BudgetValidationError(
          `${scope} ${window} limit cannot be unlimited while the organization ${window} limit is ${orgLimit} ${unit}s`,
        )
      }
      if (scoped > orgLimit) {
        throw new BudgetValidationError(
          `${scope} ${window} limit (${scoped} ${unit}s) exceeds the organization ${window} limit (${orgLimit} ${unit}s)`,
        )
      }
    }
  }

  const inserted = await repository.insertPolicySuperseding({
    organizationId,
    scope,
    subjectId,
    unit,
    dailyLimit: params.dailyLimit === null ? null : params.dailyLimit.toFixed(4),
    monthlyLimit: params.monthlyLimit === null ? null : params.monthlyLimit.toFixed(4),
    createdBy: params.actorUserId,
    note: params.note ?? null,
  })
  await invalidateLimitsCache(organizationId, scope, subjectId)
  return inserted
}

export async function clearBudgetPolicy(params: {
  organizationId: string
  scope: 'member' | 'project'
  subjectId: string
  actorUserId: string
}): Promise<boolean> {
  const unit = await getOrgBudgetUnit(params.organizationId)
  const removed = await repository.supersedeActivePolicy(params.organizationId, params.scope, params.subjectId, unit)
  if (removed) {
    await invalidateLimitsCache(params.organizationId, params.scope, params.subjectId)
  }
  return removed
}
