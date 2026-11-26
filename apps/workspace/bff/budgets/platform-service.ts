import 'server-only'
import type { UserSession } from '@/lib/auth/types'
import type { BudgetPolicy } from '@/lib/db/schema/budgets'
import { hasPlatformPermission, requirePlatformPermission } from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { withTenant } from '@/lib/db/tenant-context'
import { getWorkOS } from '@/lib/workos/client'
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import {
  getOrgSettings,
  getOrganizationDisplayName,
  listOrganizationMembers,
  updatePlatformOwnedOrgSettings,
} from '@/lib/organizations/service'
import {
  BudgetValidationError,
  getOrganizationUsageOverview,
  getOrgBudget,
  getSpendTotals,
  setBudgetPolicy,
} from './service'
import { consumed, ingested } from './spend-windows'
import {
  INGEST_ALLOWANCE_SETTING,
  ingestAllowancePutSchema,
  type IngestAllowancePut,
  type PlatformIngestAllowance,
} from './ingest-allowance-contract'
import { resolveIngestLimit, invalidateIngestAllowanceCache } from './ingest-allowance'
import { configuredIngestAllowances } from './ingest-limit'
import type { SpendWindow } from './repository'
import type { EffectiveBudgetPolicy } from './policy-lookup'
import {
  platformOrgBudgetPutSchema,
  type PlatformOrgBudget,
  type PlatformOrgBudgetInput,
  type PlatformOrgUsage,
} from './platform-contract'

async function requireOrganization(organizationId: string): Promise<void> {
  try {
    await getWorkOS().organizations.getOrganization(organizationId)
  } catch (error) {
    if (error instanceof Error && 'status' in error && error.status === 404) {
      throw new NotFoundError('Organization not found')
    }
    throw error
  }
}

async function readBudget(session: UserSession, organizationId: string): Promise<PlatformOrgBudget> {
  return withTenant({ organizationId, userId: session.userId }, async () => {
    const [budget, spend, canManage] = await Promise.all([
      getOrgBudget(organizationId),
      getSpendTotals(organizationId),
      hasPlatformPermission(session, PLATFORM_PERMISSIONS.organizationsManage),
    ])
    return {
      organizationId,
      unit: budget.unit,
      dailyLimit: budget.dailyLimit,
      monthlyLimit: budget.monthlyLimit,
      explicit: budget.explicit,
      dayUsed: consumed(spend.day, budget.unit),
      monthUsed: consumed(spend.month, budget.unit),
      ingest: await readIngestAllowance(organizationId, budget, spend.month),
      canManage,
    }
  })
}

async function readIngestAllowance(
  organizationId: string,
  budget: EffectiveBudgetPolicy,
  month: SpendWindow,
): Promise<PlatformIngestAllowance> {
  const ingest = await resolveIngestLimit(organizationId, budget.unit, budget)
  return {
    unit: budget.unit,
    monthlyAllowance: ingest.limit,
    defaultMonthlyAllowance: ingest.defaultLimit,
    explicit: ingest.explicit,
    monthUsed: ingested(month, budget.unit),
  }
}

export async function savePlatformIngestAllowance(
  session: UserSession,
  organizationId: string,
  input: IngestAllowancePut,
  request: Request,
): Promise<PlatformIngestAllowance> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsManage)
  await requireOrganization(organizationId)
  const parsed = ingestAllowancePutSchema.safeParse(input)
  if (!parsed.success) throw new UnprocessableError('Invalid ingest allowance')
  const { unit, monthlyAllowance } = parsed.data

  return withTenant({ organizationId, userId: session.userId }, async () => {
    const budget = await getOrgBudget(organizationId)
    if (budget.unit !== unit) {
      throw new ConflictError(`The organization's budget unit is ${budget.unit}, not ${unit}`)
    }
    const configured = configuredIngestAllowances((await getOrgSettings(organizationId)).settings)
    if (monthlyAllowance === null) delete configured[unit]
    else configured[unit] = monthlyAllowance

    await updatePlatformOwnedOrgSettings(session, organizationId, {
      settings: { [INGEST_ALLOWANCE_SETTING]: configured },
    })
    await invalidateIngestAllowanceCache(organizationId)

    await recordAuditEvent({
      organizationId,
      actor: { userId: session.userId, email: session.email },
      action: 'org.ingest_allowance.updated',
      targetType: 'organization',
      targetId: organizationId,
      metadata: { unit, monthlyAllowance: monthlyAllowance ?? 0, explicit: monthlyAllowance !== null },
      request,
    })

    return readIngestAllowance(organizationId, budget, (await getSpendTotals(organizationId)).month)
  })
}

export async function getPlatformOrgBudget(session: UserSession, organizationId: string): Promise<PlatformOrgBudget> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsView)
  await requireOrganization(organizationId)
  return readBudget(session, organizationId)
}

export async function savePlatformOrgBudget(
  session: UserSession,
  organizationId: string,
  input: PlatformOrgBudgetInput,
  request: Request,
): Promise<PlatformOrgBudget> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsManage)
  await requireOrganization(organizationId)
  const parsed = platformOrgBudgetPutSchema.safeParse(input)
  if (!parsed.success) throw new UnprocessableError('Invalid organization budget')

  await withTenant({ organizationId, userId: session.userId }, async () => {
    let policy: BudgetPolicy
    try {
      policy = await setBudgetPolicy({
        organizationId,
        scope: 'organization',
        subjectId: null,
        dailyLimit: parsed.data.dailyLimit,
        monthlyLimit: parsed.data.monthlyLimit,
        expectedUnit: parsed.data.unit,
        actorUserId: session.userId,
        note: parsed.data.note,
      })
    } catch (error) {
      if (error instanceof BudgetValidationError) throw new UnprocessableError(error.message)
      throw error
    }
    await recordAuditEvent({
      organizationId,
      actor: { userId: session.userId, email: session.email },
      action: 'budget.policy.set',
      targetType: 'budget_policy',
      targetId: policy.id,
      metadata: {
        scope: 'organization',
        subjectId: null,
        unit: policy.currency,
        dailyLimit: parsed.data.dailyLimit,
        monthlyLimit: parsed.data.monthlyLimit,
      },
      request,
    })
  })
  return readBudget(session, organizationId)
}

export async function getPlatformOrgUsage(session: UserSession, organizationId: string): Promise<PlatformOrgUsage> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.usageView)
  await requireOrganization(organizationId)
  const [usage, name, members] = await Promise.all([
    withTenant({ organizationId, userId: session.userId }, () => getOrganizationUsageOverview(organizationId)),
    getOrganizationDisplayName(organizationId),
    listOrganizationMembers(organizationId).catch(() => []),
  ])
  const spenders = new Set((usage.perMember ?? []).map((entry) => entry.userId))
  return {
    organization: { id: organizationId, name },
    usage,
    members: members.filter((member) => spenders.has(member.id)),
  }
}
