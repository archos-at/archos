import 'server-only'
import type { BudgetPolicy, BudgetScope } from '@/lib/db/schema/budgets'
import { recordAuditEvent } from '@/lib/audit/service'
import { BadRequestError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageBudgets } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import { resolveSubjectMembership } from '@/lib/authz/project-membership'
import { findProjectTenancy } from '@/lib/projects/repository'
import { BudgetValidationError, clearBudgetPolicy, setBudgetPolicy } from './policy-writes'

type PolicyWriteIntent = 'set' | 'clear'

async function authorizePolicyWrite(
  session: AuthorizedSession,
  scope: BudgetScope,
  subjectId: string | null,
  intent: PolicyWriteIntent,
): Promise<void> {
  if (scope === 'project') {
    if (!subjectId) {
      throw new BadRequestError('project scope requires subjectId')
    }
    if (canManageBudgets(session)) {
      const project = await findProjectTenancy(subjectId)
      if (!project || project.organizationId !== session.organizationId) {
        throw new BadRequestError('Unknown project')
      }
    } else {
      await requireProjectAccess(session, subjectId, 'project:manage')
    }
    return
  }
  if (!canManageBudgets(session)) {
    throw new ForbiddenError()
  }
  if (scope !== 'member' || intent === 'clear') return

  if (!subjectId) {
    throw new BadRequestError('member scope requires subjectId')
  }
  const membership = await resolveSubjectMembership(session.organizationId, subjectId)
  if (!membership) {
    throw new BadRequestError('Unknown member')
  }
}

export interface BudgetPolicyInput {
  scope: BudgetScope
  subjectId?: string | null
  dailyLimit: number | null
  monthlyLimit: number | null
  note?: string | null
}

export async function saveBudgetPolicy(
  session: AuthorizedSession,
  input: BudgetPolicyInput,
  request: Request,
): Promise<BudgetPolicy> {
  const { scope, dailyLimit, monthlyLimit } = input
  const subjectId = input.subjectId ?? null

  await authorizePolicyWrite(session, scope, subjectId, 'set')

  let policy: BudgetPolicy
  try {
    policy = await setBudgetPolicy({
      organizationId: session.organizationId,
      scope,
      subjectId: scope === 'organization' ? null : subjectId,
      dailyLimit,
      monthlyLimit,
      actorUserId: session.userId,
      note: input.note ?? null,
    })
  } catch (error) {
    if (error instanceof BudgetValidationError) {
      throw new UnprocessableError(error.message)
    }
    throw error
  }

  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'budget.policy.set',
    targetType: 'budget_policy',
    targetId: policy.id,
    metadata: { scope, subjectId, unit: policy.currency, dailyLimit, monthlyLimit },
    request,
  })
  return policy
}

export async function removeBudgetPolicy(
  session: AuthorizedSession,
  input: { scope: 'member' | 'project'; subjectId: string },
  request: Request,
): Promise<boolean> {
  const { scope, subjectId } = input

  await authorizePolicyWrite(session, scope, subjectId, 'clear')

  const removed = await clearBudgetPolicy({
    organizationId: session.organizationId,
    scope,
    subjectId,
    actorUserId: session.userId,
  })
  if (removed) {
    await recordAuditEvent({
      organizationId: session.organizationId,
      actor: { userId: session.userId, email: session.email },
      action: 'budget.policy.cleared',
      targetType: 'budget_policy',
      targetId: subjectId,
      metadata: { scope, subjectId },
      request,
    })
  }
  return removed
}
