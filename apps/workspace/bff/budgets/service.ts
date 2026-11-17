import 'server-only'
import type { BudgetPolicy, BudgetScope, BudgetUnit, NewLlmUsageEvent } from '@/lib/db/schema/budgets'
import { UNBILLED_USAGE_ACTIVITIES } from '@/lib/db/schema/budgets'
import { getCached, invalidateCached, invalidateCachedPrefix } from '@/lib/cache'
import { canManageBudgets } from '@/lib/authz/organizations'
import { requireProjectAccess } from '@/lib/authz/projects'
import { can } from '@/lib/authz/decide'
import { resolveSubjectMembership } from '@/lib/authz/project-membership'
import { findProjectTenancy } from '@/lib/projects/repository'
import { recordAuditEvent } from '@/lib/audit/service'
import { BadRequestError, ConflictError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { isOrgOnOwnKey } from '@/lib/llm-credentials/service'
import { requireResourceAccess } from '@/lib/sharing/access'
import {
  creditsToCostUsd,
  getEffectivePricing,
  getEffectivePricingOrBootFloor,
  priceUsage,
  type EffectivePricing,
} from '@/lib/pricing/service'
import * as repository from './repository'
import { decideUsageNotice, type ChatUsageNotice } from './usage-notice'
import type {
  AnswerUsageRow,
  DailySpendRow,
  MemberSpend,
  ModelSpend,
  OrganizationSpend,
  SpendSummary,
  SpendTotals,
  SpendWindow,
} from './repository'

export { EMPTY_SPEND_WINDOW, sumSpendWindows, utcDayStart, utcMonthStart } from './repository'
export type { BudgetUnit }
export type { DailySpendRow, MemberSpend, ModelSpend, OrganizationSpend, SpendSummary, SpendTotals, SpendWindow }

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

export type UsageEventInput = Omit<NewLlmUsageEvent, 'priceUsd' | 'credits' | 'pricingVersionId'>

export async function recordUsageEvents(events: UsageEventInput[]): Promise<number> {
  if (events.length === 0) return 0
  const pricing = await getEffectivePricingOrBootFloor()
  return repository.insertUsageEventsWithRollups(
    events.map((event) => {
      const priced =
        event.activity && UNBILLED_USAGE_ACTIVITIES.has(event.activity)
          ? { priceUsd: 0, credits: 0 }
          : priceUsage(Number.parseFloat(String(event.costUsd ?? '0')) || 0, event.isByok ?? null, pricing)
      return {
        ...event,
        priceUsd: priced.priceUsd.toFixed(8),
        credits: priced.credits.toFixed(6),
        pricingVersionId: pricing.versionId,
      }
    }),
  )
}

export async function getSpendTotals(
  organizationId: string,
  filter: { userId?: string; projectId?: string } = {},
): Promise<SpendTotals> {
  return repository.sumRollupTotals(organizationId, filter)
}

export async function getSpendSummary(
  organizationId: string,
  filter: { userId?: string; projectId?: string } = {},
): Promise<SpendSummary> {
  return repository.aggregateSpendSummary(organizationId, filter)
}

export async function getSpendByMember(organizationId: string): Promise<MemberSpend[]> {
  return repository.aggregateSpendByMember(organizationId)
}

export async function getSpendAcrossOrganizations(): Promise<OrganizationSpend[]> {
  return repository.aggregateSpendAcrossOrganizations()
}

export interface DailySpendPoint extends SpendWindow {
  day: string
}

export async function getDailySpendTrend(options: {
  organizationId?: string
  days?: number
} = {}): Promise<DailySpendPoint[]> {
  const days = Math.min(Math.max(options.days ?? 30, 1), 90)
  const start = repository.utcDayStart()
  start.setUTCDate(start.getUTCDate() - (days - 1))

  const rows = await repository.aggregateDailySpend({ organizationId: options.organizationId, start })

  const byDay = new Map(rows.map((row) => [row.day, row]))
  const series: DailySpendPoint[] = []
  const cursor = new Date(start)
  for (let i = 0; i < days; i += 1) {
    const key = cursor.toISOString().slice(0, 10)
    const row = byDay.get(key)
    series.push({
      day: key,
      costUsd: row?.costUsd ?? 0,
      ownKeyCostUsd: row?.ownKeyCostUsd ?? 0,
      priceUsd: row?.priceUsd ?? 0,
      credits: row?.credits ?? 0,
      tokens: row?.tokens ?? 0,
      events: row?.events ?? 0,
    })
    cursor.setUTCDate(cursor.getUTCDate() + 1)
  }
  return series
}

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

const consumed = (window: SpendWindow, unit: BudgetUnit): number =>
  unit === 'token' ? window.tokens : window.credits

function remainingIn(limits: BudgetLimits, spend: SpendTotals): number | null {
  const candidates: number[] = []
  if (limits.dailyLimit !== null) candidates.push(limits.dailyLimit - consumed(spend.day, limits.unit))
  if (limits.monthlyLimit !== null) candidates.push(limits.monthlyLimit - consumed(spend.month, limits.unit))
  if (candidates.length === 0) return null
  return Math.max(0, Math.min(...candidates))
}

const LIMITS_CACHE_TTL_MS = 5 * 60 * 1000

const limitsCacheKey = (organizationId: string, unit: BudgetUnit, scope: BudgetScope, subjectId: string | null): string =>
  `budgetlimits:${organizationId}:${unit}:${scope}:${subjectId ?? ''}`

async function getCachedOrgLimits(organizationId: string, unit: BudgetUnit): Promise<BudgetLimits> {
  return getCached(limitsCacheKey(organizationId, unit, 'organization', null), LIMITS_CACHE_TTL_MS, async () => {
    const org = await getOrgBudget(organizationId, unit)
    return { unit: org.unit, dailyLimit: org.dailyLimit, monthlyLimit: org.monthlyLimit }
  })
}

async function getCachedScopedLimits(
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

async function invalidateLimitsCache(
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

export interface ConnectionDiagnostics {
  budgetExhausted: boolean
  blockedScope: BudgetScope | null
  canManageBudgets: boolean
}

export async function getConnectionDiagnostics(
  session: AuthorizedSession,
  requested: { projectId?: string } = {},
): Promise<ConnectionDiagnostics> {
  const status = await getBudgetStatus(session.organizationId, session.userId, requested.projectId ?? null)
  return {
    budgetExhausted: status.blocked,
    blockedScope: status.blockedScope,
    canManageBudgets: canManageBudgets(session),
  }
}

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

export interface TenantSpendWindow {
  amount: number
  events: number
}

const toTenantWindow =
  (unit: BudgetUnit) =>
  (window: SpendWindow): TenantSpendWindow => ({
    amount: consumed(window, unit),
    events: window.events,
  })

export interface UsageOverview {
  unit: BudgetUnit
  summary: {
    day: TenantSpendWindow
    month: TenantSpendWindow
    perModel: Array<{ model: string; day: TenantSpendWindow; month: TenantSpendWindow }>
  }
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

export type { EffectivePricing }


export interface AnswerUsage extends AnswerUsageRow {
  unit: BudgetUnit
}

export async function getAnswerUsage(
  session: AuthorizedSession,
  conversationId: string,
  messageId: string,
): Promise<AnswerUsage | null> {
  await requireResourceAccess(session, 'conversation', conversationId, 'viewer')
  const [row, unit] = await Promise.all([
    repository.sumAnswerUsage(session.organizationId, conversationId, messageId),
    getOrgBudgetUnit(session.organizationId),
  ])
  return row ? { ...row, unit } : null
}
