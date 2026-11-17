import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'

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
