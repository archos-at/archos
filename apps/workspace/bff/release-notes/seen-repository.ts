import 'server-only'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { userPreferences } from '@/lib/db/schema/user-preferences'

export interface ReleaseNoticeRecord {
  readonly lastSeenWeek: string | null
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
