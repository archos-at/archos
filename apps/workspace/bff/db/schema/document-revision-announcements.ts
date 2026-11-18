import { foreignKey, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { documents } from './documents'

export const documentRevisionAnnouncements = pgTable(
  'document_revision_announcements',
  {
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id').notNull(),
    anchorId: uuid('anchor_id').notNull(),
    announcedAt: timestamp('announced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pk: primaryKey({ name: 'document_revision_announcements_pk', columns: [table.documentId, table.anchorId] }),
    document: foreignKey({
      name: 'document_revision_announcements_document_fkey',
      columns: [table.documentId],
      foreignColumns: [documents.id],
    }).onDelete('cascade'),
  })
)

export type DocumentRevisionAnnouncement = typeof documentRevisionAnnouncements.$inferSelect
