import 'server-only'
import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { canManageBudgets } from '@/lib/authz/organizations'
import type { AuthorizedSession } from '@/lib/auth/types'
import { getBudgetStatus } from './budget-status'
import { getOrgBudget, getOrgBudgetUnit } from './policy-lookup'
import { getDailySpendTrend, getSpendByMember, getSpendSummary } from './spend-queries'
import { ingestLimitOf } from './ingest-limit'
import { toTenantIngestWindow, toTenantWindow, type TenantSpendWindow } from './spend-windows'

export interface UsageOverview {
  unit: BudgetUnit
  summary: {
    day: TenantSpendWindow
    month: TenantSpendWindow
    perModel: Array<{ model: string; day: TenantSpendWindow; month: TenantSpendWindow }>
  }
  ingest: { month: TenantSpendWindow; monthlyLimit: number | null }
  perMember: Array<{ userId: string; day: TenantSpendWindow; month: TenantSpendWindow }> | null
  dailyTrend: Array<{ day: string } & TenantSpendWindow> | null
  orgBudget: { dailyLimit: number | null; monthlyLimit: number | null; explicit: boolean }
  status: { blocked: boolean; blockedScope: BudgetScope | null }
  scope: { userId?: string; projectId?: string }
}

export async function getUsageOverview(
  session: AuthorizedSession,
  requested: { userId?: string; projectId?: string } = {},
): Promise<UsageOverview> {
  const admin = canManageBudgets(session)

  const filter: { userId?: string; projectId?: string } = {}
  if (admin) {
    if (requested.userId) filter.userId = requested.userId
    if (requested.projectId) filter.projectId = requested.projectId
  } else {
    filter.userId = session.userId
  }

  return assembleUsageOverview(session.organizationId, {
    filter,
    statusUserId: session.userId,
    admin,
    scope: admin ? filter : { userId: session.userId },
  })
}

export async function getOrganizationUsageOverview(organizationId: string): Promise<UsageOverview> {
  return assembleUsageOverview(organizationId, { filter: {}, statusUserId: null, admin: true, scope: {} })
}

async function assembleUsageOverview(
  organizationId: string,
  options: {
    filter: { userId?: string; projectId?: string }
    statusUserId: string | null
    admin: boolean
    scope: { userId?: string; projectId?: string }
  },
): Promise<UsageOverview> {
  const { filter, statusUserId, admin, scope } = options
  const unit = await getOrgBudgetUnit(organizationId)
  const project = toTenantWindow(unit)
  const projectIngest = toTenantIngestWindow(unit)

  const [summary, orgBudget, status, perMember, dailyTrend] = await Promise.all([
    getSpendSummary(organizationId, filter),
    getOrgBudget(organizationId, unit),
    getBudgetStatus(organizationId, statusUserId, null),
    admin ? getSpendByMember(organizationId) : Promise.resolve(null),
    admin ? getDailySpendTrend({ organizationId, days: 30 }) : Promise.resolve(null),
  ])

  return {
    unit,
    summary: {
      day: project(summary.day),
      month: project(summary.month),
      perModel: summary.perModel.map((entry) => ({
        model: entry.model,
        day: project(entry.day),
        month: project(entry.month),
      })),
    },
    ingest: {
      month: projectIngest(summary.month),
      monthlyLimit: ingestLimitOf(orgBudget),
    },
    perMember: perMember
      ? perMember.map((entry) => ({ userId: entry.userId, day: project(entry.day), month: project(entry.month) }))
      : null,
    dailyTrend: dailyTrend ? dailyTrend.map((point) => ({ day: point.day, ...project(point) })) : null,
    orgBudget: {
      dailyLimit: orgBudget.dailyLimit,
      monthlyLimit: orgBudget.monthlyLimit,
      explicit: orgBudget.explicit,
    },
    status: { blocked: status.blocked, blockedScope: status.blockedScope },
    scope,
  }
}
