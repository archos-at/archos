import { sql } from 'drizzle-orm'
import { doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { CalibrationScope, CalibrationStatus } from '@/lib/drawing-calibrations/wire'
import { documents } from './documents'
import { documentVersions } from './document-versions'

export const drawingCalibrations = pgTable(
  'drawing_calibrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    versionId: uuid('version_id')
      .notNull()
      .references(() => documentVersions.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    regionX: doublePrecision('region_x').notNull(),
    regionY: doublePrecision('region_y').notNull(),
    regionW: doublePrecision('region_w').notNull(),
    regionH: doublePrecision('region_h').notNull(),
    pointAX: doublePrecision('point_a_x').notNull(),
    pointAY: doublePrecision('point_a_y').notNull(),
    pointBX: doublePrecision('point_b_x').notNull(),
    pointBY: doublePrecision('point_b_y').notNull(),
    referenceLengthM: doublePrecision('reference_length_m').notNull(),
    scope: text('scope').$type<CalibrationScope>().notNull().default('page'),
    referenceWidthPt: doublePrecision('reference_width_pt'),
    referenceHeightPt: doublePrecision('reference_height_pt'),
    status: text('status').$type<CalibrationStatus>().notNull().default('active'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp('withdrawn_at', { withTimezone: true }),
    withdrawnBy: text('withdrawn_by'),
  },
  (table) => ({
    pageIdx: index('idx_drawing_calibrations_page').on(
      table.organizationId,
      table.documentId,
      table.versionId,
      table.page,
      table.createdAt
    ),
    activeRegionUnique: uniqueIndex('uniq_drawing_calibrations_active_region')
      .on(table.organizationId, table.versionId, table.page, table.regionX, table.regionY, table.regionW, table.regionH)
      .where(sql`${table.status} = 'active' and ${table.scope} = 'page'`),
    activeDocumentUnique: uniqueIndex('uniq_drawing_calibrations_active_document')
      .on(table.organizationId, table.versionId)
      .where(sql`${table.status} = 'active' and ${table.scope} = 'document'`),
  })
)

export type DrawingCalibrationRow = typeof drawingCalibrations.$inferSelect
export type NewDrawingCalibrationRow = typeof drawingCalibrations.$inferInsert
