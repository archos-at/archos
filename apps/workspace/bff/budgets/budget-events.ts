/**
 * Budget events for PostHog (ADR-0100): a budget refused a turn
 * (`budget_blocked`), or spend crossed 80 % or 100 % of a limit
 * (`budget_threshold_crossed`).
 *
 * Both are signals a customer-success person wants before the customer writes in:
 * an office that keeps hitting its monthly limit is about to ask for a bigger
 * one, or to leave. And both are the kind of event that repeats: a blocked user
 * reconnects until they give up, and every usage batch after the 80 % mark is
 * still past it. So each is sent ONCE per window it concerns, and the "once"
 * lives in the shared cache (Dragonfly), not in process memory, because the
 * BFF runs several replicas and each would otherwise announce its own copy.
 *
 * **The cache is used as a set-if-absent.** `getCached` runs its loader only
 * when no value is stored, and the loader at each call below is the send. That makes the
 * first caller in a window the one that sends and every later one a hit. When
 * the cache store is down, `getCached` fails open to the loader, so the cost of
 * an outage is a repeated event, never a lost one. Every key carries the
 * organization first (`grid/require-tenant-cache-key`): a key without it would
 * make one tenant's announcement silence another's.
 *
 * Fire-and-forget by contract. The callers do not await these, and nothing here
 * throws: a budget refusal or a usage write must answer exactly as before
 * whether PostHog is up, down or unconfigured. With PostHog off, the threshold
 * check returns before it reads the ledger, so a deployment that sends nothing
 * pays nothing.
 */
import 'server-only'

import { captureServer, isPosthogServerEnabled } from '@/lib/analytics/posthog-server'
import { getCached } from '@/lib/cache'
import type { BudgetScope, BudgetUnit } from '@/lib/db/schema/budgets'
import { withTenant } from '@/lib/db/tenant-context'
import { getOrganizationDisplayName } from '@/lib/organizations/service'
import { getBudgetUtilisation, type BudgetUtilisation } from './service'
import { utcWindow } from './usage-notice'

/** Percent of a limit that is worth an event, highest first. */
export const BUDGET_THRESHOLDS = [100, 80] as const
export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number]

/** A blocked user is announced once an hour: long enough to absorb a reconnect loop. */
const BLOCKED_ONCE_MS = 60 * 60_000
const HOUR_MS = 60 * 60_000
const MINUTE_MS = 60_000

/** The highest threshold `used` has reached, or `null`. A zero limit is spent already. */
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

/** The exhausted window of `scope` that renews last: the one that decides when chat works again. */
const exhaustedWindow = (usages: readonly BudgetUtilisation[], scope: BudgetScope): BudgetUtilisation | null => {
  const spent = usages.filter((usage) => usage.scope === scope && usage.used >= usage.limit)
  return spent.find((usage) => usage.window === 'month') ?? spent[0] ?? null
}

/** The organization's display name for the event; null when WorkOS cannot say (never throws). */
const nameOf = (organizationId: string): Promise<string | null> =>
  getOrganizationDisplayName(organizationId).catch(() => null)

/**
 * `budget_blocked`: the WebSocket upgrade was refused because a budget scope is
 * exhausted. The distinct id is the person who was refused. Properties: which
 * scope blocked, in which unit, the limit and what was used of it (the window
 * that is spent), the refused person's role and the office's name. Both
 * lookups run inside the once-per-hour send, never on a repeat.
 */
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

/**
 * `budget_threshold_crossed`, after a usage batch landed: for each limited
 * window that applies to this user and project, the highest of 80 / 100 % it
 * has reached, once per window. Personless: spend crossing a line is the
 * system's observation, not anyone's act (`user_role` is `system`; `blocked_scope`
 * repeats `scope` so one insight reads both events). `subject_id` is the project's id for
 * a project budget and absent otherwise; a member budget carries no id at all.
 */
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
            // Personless: spend crossing a line is nobody's act, so no role.
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
