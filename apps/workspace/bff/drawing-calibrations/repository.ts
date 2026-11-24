import 'server-only'
import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { OffsetPage } from '@/lib/api/offset-page'
import { getDb } from '@/lib/db'
import { isUniqueViolation } from '@/lib/db/errors'
import { documents } from '@/lib/db/schema/documents'
import { drawingCalibrations, type DrawingCalibrationRow } from '@/lib/db/schema/drawing-calibrations'
import { withTenant } from '@/lib/db/tenant-context'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import {
  CALIBRATION_LIFECYCLE,
  type CalibrationPoint,
  type CalibrationRegion,
  type CalibrationStatus,
  regionRelation,
} from './wire'

const ACTIVE_REGION_INDEX = 'uniq_drawing_calibrations_active_region'

export class CalibrationSetConflictError extends Error {}

export class CalibrationRegionOverlapError extends Error {
  constructor(readonly overlapping: DrawingCalibrationRow) {
    super(`The region partly overlaps the active calibration ${overlapping.id}.`)
  }
}

const regionOf = (row: DrawingCalibrationRow): CalibrationRegion => ({
  x: row.regionX,
  y: row.regionY,
  w: row.regionW,
  h: row.regionH,
})

export interface CalibrationFilter {
  organizationId: string
  documentId: string
  versionId: string
  page?: number
  status: CalibrationStatus
}

export async function listDrawingCalibrations(
  filter: CalibrationFilter,
  reader: DocumentReader,
  window: OffsetPage
): Promise<DrawingCalibrationRow[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId: filter.organizationId }, () =>
    db
      .select({ row: drawingCalibrations })
      .from(drawingCalibrations)
      .innerJoin(documents, eq(documents.id, drawingCalibrations.documentId))
      .where(
        and(
          eq(drawingCalibrations.organizationId, filter.organizationId),
          eq(documents.organizationId, filter.organizationId),
          eq(drawingCalibrations.documentId, filter.documentId),
          eq(drawingCalibrations.versionId, filter.versionId),
          eq(drawingCalibrations.status, filter.status),
          ...(filter.page === undefined ? [] : [eq(drawingCalibrations.page, filter.page)]),
          documentVisibleTo(reader)
        )
      )
      .orderBy(asc(drawingCalibrations.createdAt), asc(drawingCalibrations.id))
      .limit(window.limit + 1)
      .offset(window.offset)
  )
  return rows.map(({ row }) => row)
}

export async function findDrawingCalibration(
  organizationId: string,
  documentId: string,
  calibrationId: string,
  reader: DocumentReader
): Promise<DrawingCalibrationRow | null> {
  const db = getDb()
  const [found] = await withTenant({ organizationId }, () =>
    db
      .select({ row: drawingCalibrations })
      .from(drawingCalibrations)
      .innerJoin(documents, eq(documents.id, drawingCalibrations.documentId))
      .where(
        and(
          eq(drawingCalibrations.organizationId, organizationId),
          eq(documents.organizationId, organizationId),
          eq(drawingCalibrations.documentId, documentId),
          eq(drawingCalibrations.id, calibrationId),
          documentVisibleTo(reader)
        )
      )
      .limit(1)
  )
  return found?.row ?? null
}

export interface NewCalibrationInput {
  organizationId: string
  documentId: string
  versionId: string
  page: number
  region: CalibrationRegion
  from: CalibrationPoint
  to: CalibrationPoint
  lengthM: number
  createdBy: string
}

export async function setDrawingCalibration(input: NewCalibrationInput): Promise<DrawingCalibrationRow> {
  const { organizationId, region } = input
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${`drawing_calibrations:${organizationId}:${input.versionId}:${input.page}`}, 0))`
        )
        const active = await tx
          .select()
          .from(drawingCalibrations)
          .where(
            and(
              eq(drawingCalibrations.organizationId, organizationId),
              eq(drawingCalibrations.documentId, input.documentId),
              eq(drawingCalibrations.versionId, input.versionId),
              eq(drawingCalibrations.page, input.page),
              inArray(drawingCalibrations.status, [...CALIBRATION_LIFECYCLE.sourcesOf('supersede')])
            )
          )
          .orderBy(asc(drawingCalibrations.createdAt), asc(drawingCalibrations.id))
        const relations = active.map((row) => ({ row, relation: regionRelation(region, regionOf(row)) }))
        const overlapping = relations.find(({ relation }) => relation === 'overlaps')
        if (overlapping) throw new CalibrationRegionOverlapError(overlapping.row)
        const same = relations.filter(({ relation }) => relation === 'same').map(({ row }) => row.id)
        if (same.length > 0) {
          await tx
            .update(drawingCalibrations)
            .set({ status: 'superseded' })
            .where(and(eq(drawingCalibrations.organizationId, organizationId), inArray(drawingCalibrations.id, same)))
        }
        const [row] = await tx
          .insert(drawingCalibrations)
          .values({
            organizationId,
            documentId: input.documentId,
            versionId: input.versionId,
            page: input.page,
            regionX: region.x,
            regionY: region.y,
            regionW: region.w,
            regionH: region.h,
            pointAX: input.from.x,
            pointAY: input.from.y,
            pointBX: input.to.x,
            pointBY: input.to.y,
            referenceLengthM: input.lengthM,
            status: CALIBRATION_LIFECYCLE.initial,
            createdBy: input.createdBy,
          })
          .returning()
        return row
      })
      .catch((error: unknown) => {
        if (isUniqueViolation(error, ACTIVE_REGION_INDEX)) throw new CalibrationSetConflictError()
        throw error
      })
  )
}

export async function withdrawDrawingCalibration(
  organizationId: string,
  documentId: string,
  calibrationId: string,
  withdrawnBy: string
): Promise<DrawingCalibrationRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(drawingCalibrations)
      .set({ status: 'withdrawn', withdrawnAt: sql`now()`, withdrawnBy })
      .where(
        and(
          eq(drawingCalibrations.organizationId, organizationId),
          eq(drawingCalibrations.documentId, documentId),
          eq(drawingCalibrations.id, calibrationId),
          inArray(drawingCalibrations.status, [...CALIBRATION_LIFECYCLE.sourcesOf('withdraw')])
        )
      )
      .returning()
  )
  return row ?? null
}
