import 'server-only'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withOptionalTenant, withTenant } from '@/lib/db/tenant-context'
import { userPreferences } from '@/lib/db/schema/user-preferences'

export async function findUserPreferences(
  workosUserId: string,
  organizationId: string,
): Promise<Record<string, unknown> | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId, userId: workosUserId }, () =>
    db
      .select({ prefs: userPreferences.prefs })
      .from(userPreferences)
      .where(eq(userPreferences.workosUserId, workosUserId))
      .limit(1),
  )
  return (row?.prefs as Record<string, unknown> | undefined) ?? null
}

export async function upsertUserPreferences(
  workosUserId: string,
  organizationId: string,
  prefs: Record<string, unknown>,
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId, userId: workosUserId }, () =>
    db
      .insert(userPreferences)
      .values({ workosUserId, prefs })
      .onConflictDoUpdate({
        target: userPreferences.workosUserId,
        set: { prefs },
      }),
  )
}

export async function findUserPreferencesForSession(
  workosUserId: string,
  organizationId: string | null | undefined,
): Promise<Record<string, unknown> | null> {
  const db = getDb()
  const [row] = await withOptionalTenant(
    organizationId,
    'active-project preference lookup for a session with no organization selected',
    () =>
      db
        .select({ prefs: userPreferences.prefs })
        .from(userPreferences)
        .where(eq(userPreferences.workosUserId, workosUserId))
        .limit(1),
  )
  return (row?.prefs as Record<string, unknown> | undefined) ?? null
}
