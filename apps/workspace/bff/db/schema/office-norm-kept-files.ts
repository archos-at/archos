import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { documents } from './documents'

export const officeNormKeptFiles = pgTable(
  'office_norm_kept_files',
  {
    documentId: uuid('document_id')
      .primaryKey()
      .references(() => documents.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').notNull(),
    keptBy: text('kept_by').notNull(),
    keptAt: timestamp('kept_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    organizationIdx: index('idx_office_norm_kept_files_organization').on(table.organizationId),
  })
)

export type OfficeNormKeptFile = typeof officeNormKeptFiles.$inferSelect
