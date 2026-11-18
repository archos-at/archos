import 'server-only'

import { captureServer, isPosthogServerEnabled } from '@/lib/analytics/posthog-server'
import { getCached } from '@/lib/cache'
import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { withTenant } from '@/lib/db/tenant-context'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { getBudgetUtilisation, type BudgetUtilisation } from './service'
import { utcWindow } from './usage-notice'

export const BUDGET_THRESHOLDS = [100, 80] as const
export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number]

const BLOCKED_ONCE_MS = 60 * 60_000
const HOUR_MS = 60 * 60_000
const MINUTE_MS = 60_000

export const thresholdReached = (used: number, limit: number): BudgetThreshold | null => {
  const percent = limit > 0 ? (used / limit) * 100 : 100
  return BUDGET_THRESHOLDS.find((threshold) => percent >= threshold) ?? null
}

const blockedKey = (organizationId: string, userId: string, scope: BudgetScope): string =>
  `budgetevent:blocked:${organizationId}:${userId}:${scope}`

const thresholdKey = (
  organizationId: string,
  usage: BudgetUtilisation,
  windowId: string,
  threshold: BudgetThreshold,
): string =>
  `budgetevent:threshold:${organizationId}:${usage.scope}:${usage.subjectId ?? 'all'}:${usage.window}:${windowId}:${threshold}`

const exhaustedWindow = (usages: readonly BudgetUtilisation[], scope: BudgetScope): BudgetUtilisation | null => {
  const spent = usages.filter((usage) => usage.scope === scope && usage.used >= usage.limit)
  return spent.find((usage) => usage.window === 'month') ?? spent[0] ?? null
}

const nameOf = (organizationId: string): Promise<string | null> =>
  getOrganizationDisplayName(organizationId).catch(() => null)

export async function announceBudgetBlocked(params: {
  organizationId: string
  userId: string
  userRole: string | null
  projectId?: string | null
  scope: BudgetScope
  unit: BudgetUnit
}): Promise<void> {
  if (!isPosthogServerEnabled()) return
  const { organizationId, userId, userRole, projectId = null, scope, unit } = params
  try {
    await getCached(blockedKey(organizationId, userId, scope), BLOCKED_ONCE_MS, async () => {
      const [name, usages] = await Promise.all([
        nameOf(organizationId),
        withTenant({ organizationId }, () => getBudgetUtilisation(organizationId, userId, projectId)).catch(
          () => [] as BudgetUtilisation[],
        ),
      ])
      const spent = exhaustedWindow(usages, scope)
      captureServer({
        event: 'budget_blocked',
        distinctId: userId,
        organizationId,
        properties: {
          blocked_scope: scope,
          unit,
          organization_name: name,
          user_role: userRole,
          limit: spent?.limit,
          used: spent?.used,
          window: spent?.window,
        },
      })
      return true
    })
  } catch (error) {
    console.debug('[posthog] could not announce a blocked budget', error)
  }
}

export async function announceBudgetThresholds(params: {
  organizationId: string
  userId: string | null
  projectId: string | null
  now?: Date
}): Promise<void> {
  if (!isPosthogServerEnabled()) return
  const { organizationId, userId, projectId, now = new Date() } = params
  try {
    const usages = await withTenant({ organizationId }, () => getBudgetUtilisation(organizationId, userId, projectId))
    for (const usage of usages) {
      const threshold = thresholdReached(usage.used, usage.limit)
      if (threshold === null) continue
      const window = utcWindow(usage.window, now)
      const ttlMs = Math.max(MINUTE_MS, window.endsAt - now.getTime() + HOUR_MS)
      await getCached(thresholdKey(organizationId, usage, window.id, threshold), ttlMs, async () => {
        const name = await nameOf(organizationId)
        captureServer({
          event: 'budget_threshold_crossed',
          distinctId: null,
          organizationId,
          properties: {
            scope: usage.scope,
            window: usage.window,
            pct: threshold,
            unit: usage.unit,
            limit: usage.limit,
            used: usage.used,
            blocked_scope: usage.scope,
            organization_name: name,
            user_role: 'system',
            subject_id: usage.scope === 'project' ? usage.subjectId : undefined,
          },
        })
        return true
      })
    }
  } catch (error) {
    console.debug('[posthog] could not announce a budget threshold', error)
  }
}
