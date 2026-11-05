/**
 * The person's own record for the weekly-summary notice (migration 0194, ADR-0154 amendment):
 * `user_preferences.last_seen_release_week`, the newest summary they have seen, and
 * `release_summary_notice`, whether they want the notice at all. The only module that reads or
 * writes those columns.
 *
 * The row is the person's own, under the `workos_user_id = current_user_id()` policy, so the
 * scope carries the user as well as the organization, as the preferences repository's does.
 */

import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { userPreferences } from '@/lib/db/schema/user-preferences'

export interface ReleaseNoticeRecord {
  /** The newest week whose summary the person has seen, or null for never. */
  readonly lastSeenWeek: string | null
  /** Whether they want the notice; true when they have no row. */
  readonly enabled: boolean
}

export async function findReleaseNoticeRecord(userId: string, organizationId: string): Promise<ReleaseNoticeRecord> {
  const db = getDb()
  const [row] = await withTenant({ organizationId, userId }, () =>
    db
      .select({ week: userPreferences.lastSeenReleaseWeek, enabled: userPreferences.releaseSummaryNotice })
      .from(userPreferences)
      .where(eq(userPreferences.workosUserId, userId))
      .limit(1),
  )
  return { lastSeenWeek: row?.week ?? null, enabled: row?.enabled ?? true }
}

/**
 * Record `week` as seen, never moving backwards: a stale tab marking an older week leaves a newer
 * one standing. `GREATEST` skips a NULL, and an ISO week id sorts as text. With `enabled`, also
 * sets the switch in the same write ("Nicht mehr anzeigen" is both). Returns what is stored.
 */
export async function recordReleaseWeekSeen(
  userId: string,
  organizationId: string,
  week: string,
  enabled?: boolean,
): Promise<ReleaseNoticeRecord> {
  const db = getDb()
  const [row] = await withTenant({ organizationId, userId }, () =>
    db
      .insert(userPreferences)
      .values({ workosUserId: userId, lastSeenReleaseWeek: week, ...(enabled === undefined ? {} : { releaseSummaryNotice: enabled }) })
      .onConflictDoUpdate({
        target: userPreferences.workosUserId,
        set: {
          lastSeenReleaseWeek: sql`GREATEST(${userPreferences.lastSeenReleaseWeek}, excluded.last_seen_release_week)`,
          ...(enabled === undefined ? {} : { releaseSummaryNotice: enabled }),
        },
      })
      .returning({ week: userPreferences.lastSeenReleaseWeek, enabled: userPreferences.releaseSummaryNotice }),
  )
  return { lastSeenWeek: row?.week ?? week, enabled: row?.enabled ?? enabled ?? true }
}

/** Turn the notice on or off for the person. Leaves the seen week as it is. */
export async function setReleaseNoticeEnabled(
  userId: string,
  organizationId: string,
  enabled: boolean,
): Promise<ReleaseNoticeRecord> {
  const db = getDb()
  const [row] = await withTenant({ organizationId, userId }, () =>
    db
      .insert(userPreferences)
      .values({ workosUserId: userId, releaseSummaryNotice: enabled })
      .onConflictDoUpdate({ target: userPreferences.workosUserId, set: { releaseSummaryNotice: enabled } })
      .returning({ week: userPreferences.lastSeenReleaseWeek, enabled: userPreferences.releaseSummaryNotice }),
  )
  return { lastSeenWeek: row?.week ?? null, enabled: row?.enabled ?? enabled }
}
