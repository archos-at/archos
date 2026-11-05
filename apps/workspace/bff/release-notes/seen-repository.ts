/**
 * Which weekly release-notes summary a person has seen: `user_preferences.last_seen_release_week`
 * (migration 0194, ADR-0154 amendment). The only module that reads or writes that column.
 *
 * The row is the person's own, under the `workos_user_id = current_user_id()` policy, so the
 * scope carries the user as well as the organization, as the preferences repository's does.
 */

import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { userPreferences } from '@/lib/db/schema/user-preferences'

export async function findLastSeenReleaseWeek(userId: string, organizationId: string): Promise<string | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId, userId }, () =>
    db
      .select({ week: userPreferences.lastSeenReleaseWeek })
      .from(userPreferences)
      .where(eq(userPreferences.workosUserId, userId))
      .limit(1),
  )
  return row?.week ?? null
}

/**
 * Record `week` as seen, never moving backwards: a stale tab marking an older week leaves a newer
 * one standing. `GREATEST` skips a NULL, and an ISO week id sorts as text. Returns what is stored.
 */
export async function recordReleaseWeekSeen(userId: string, organizationId: string, week: string): Promise<string> {
  const db = getDb()
  const [row] = await withTenant({ organizationId, userId }, () =>
    db
      .insert(userPreferences)
      .values({ workosUserId: userId, lastSeenReleaseWeek: week })
      .onConflictDoUpdate({
        target: userPreferences.workosUserId,
        set: { lastSeenReleaseWeek: sql`GREATEST(${userPreferences.lastSeenReleaseWeek}, excluded.last_seen_release_week)` },
      })
      .returning({ week: userPreferences.lastSeenReleaseWeek }),
  )
  return row?.week ?? week
}
