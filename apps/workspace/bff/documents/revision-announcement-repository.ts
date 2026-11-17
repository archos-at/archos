import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { documentRevisionAnnouncements } from '@/lib/db/schema/document-revision-announcements'
import { withTenant } from '@/lib/db/tenant-context'

export interface RevisionAnnouncementKey {
  organizationId: string
  documentId: string
  anchorId: string
}

export async function claimRevisionAnnouncement(key: RevisionAnnouncementKey, executor?: DbExecutor): Promise<boolean> {
  const db = executor ?? getDb()
  const claimed = await withTenant({ organizationId: key.organizationId }, () =>
    db
      .insert(documentRevisionAnnouncements)
      .values({ organizationId: key.organizationId, documentId: key.documentId, anchorId: key.anchorId })
      .onConflictDoNothing({ target: [documentRevisionAnnouncements.documentId, documentRevisionAnnouncements.anchorId] })
      .returning({ documentId: documentRevisionAnnouncements.documentId }),
  )
  return claimed.length > 0
}

export async function releaseRevisionAnnouncement(key: RevisionAnnouncementKey): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId: key.organizationId }, () =>
    db
      .delete(documentRevisionAnnouncements)
      .where(
        and(
          eq(documentRevisionAnnouncements.organizationId, key.organizationId),
          eq(documentRevisionAnnouncements.documentId, key.documentId),
          eq(documentRevisionAnnouncements.anchorId, key.anchorId),
        ),
      ),
  )
}
