/**
 * One change of a project's roster at a time.
 *
 * Who holds which project role lives in WorkOS, which has no transaction and no
 * compare-and-set: every roster change reads the assignments, decides (the
 * last-admin rule, the grant ceiling) and then writes. Two changes running side
 * by side both read the old list, so two admins demoting each other at the same
 * moment both pass the last-admin rule and leave the project with none. A
 * transaction-scoped Postgres advisory lock on the project serializes them
 * across every replica, as `setFolderAccess` does for a folder's list.
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'

/** Runs `work` while holding the project's roster lock; the lock is released when it settles. */
export async function withProjectMembersLock<T>(
  organizationId: string,
  projectId: string,
  work: () => Promise<T>
): Promise<T> {
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`project_members:${organizationId}:${projectId}`}, 0))`)
      return work()
    })
  )
}
