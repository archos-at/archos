import { sql } from 'drizzle-orm'
import { doublePrecision, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import type { CalibrationStatus } from '@/lib/drawing-calibrations/wire'
import { documents } from './documents'
import { documentVersions } from './document-versions'

/**
 * Drawing calibrations (ADR-0183, migration 0236): the scale a person set for a
 * region of a page of one version of a drawing. Row-level security is the
 * organization's (`organization_id = current_org()`); who may read a row is the
 * document's own rule, so every read joins `documents` and ANDs
 * `documentVisibleTo(reader)` (`lib/drawing-calibrations/repository.ts`).
 *
 * The CHECKs live in the migration: the region lies on the page, both points
 * lie in it and differ, the length is positive, and a row is
 * stamped withdrawn exactly when its status says so.
 */
export const drawingCalibrations = pgTable(
  'drawing_calibrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    /** The version the person looked at. Never null: a calibration is true of one version's bytes. */
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
      .where(sql`${table.status} = 'active'`),
  })
)

export type DrawingCalibrationRow = typeof drawingCalibrations.$inferSelect
export type NewDrawingCalibrationRow = typeof drawingCalibrations.$inferInsert
