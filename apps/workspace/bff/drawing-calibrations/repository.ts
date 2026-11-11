/**
 * Drawing calibrations repository: the SQL over `drawing_calibrations`
 * (migration 0236).
 *
 * No authorization here; the service owns that. Every read joins `documents`
 * and ANDs the reader's `documentVisibleTo`, which is what
 * `documents/document-visibility.spec.ts` holds each function here to: a held
 * upload's calibrations exist for nobody the upload is held from. The writes
 * act on a document the service read for writing first.
 */

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
} from './wire'

/** The partial unique index that allows one active calibration per region (migration 0236). */
const ACTIVE_REGION_INDEX = 'uniq_drawing_calibrations_active_region'

/** Thrown when somebody else set the same region in the same moment: the unique index refused the second active row. */
export class CalibrationSetConflictError extends Error {}

export interface CalibrationFilter {
  organizationId: string
  documentId: string
  /** The version whose calibrations are read: none carries over to another. */
  versionId: string
  page?: number
  status: CalibrationStatus
}

/**
 * The calibrations of one version of a document, oldest first, as this reader
 * may see the document. Bounded: `window.limit + 1` rows from `window.offset`,
 * the extra row telling the caller whether another page follows. Oldest first
 * keeps an offset stable while people set new ones.
 */
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

/** One calibration of one document, whatever its status and version, or null. */
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

/**
 * Set a region's calibration in ONE transaction: the active row of the same
 * version, page and exact region becomes `superseded`, and the new row is
 * inserted `active`. Two people setting one region at once cannot both win:
 * the second insert meets the unique index and is a
 * {@link CalibrationSetConflictError}, with nothing of it kept.
 */
export async function setDrawingCalibration(input: NewCalibrationInput): Promise<DrawingCalibrationRow> {
  const { organizationId, region } = input
  const db = getDb()
  return withTenant({ organizationId }, () =>
    db
      .transaction(async (tx) => {
        await tx
          .update(drawingCalibrations)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(drawingCalibrations.organizationId, organizationId),
              eq(drawingCalibrations.documentId, input.documentId),
              eq(drawingCalibrations.versionId, input.versionId),
              eq(drawingCalibrations.page, input.page),
              eq(drawingCalibrations.regionX, region.x),
              eq(drawingCalibrations.regionY, region.y),
              eq(drawingCalibrations.regionW, region.w),
              eq(drawingCalibrations.regionH, region.h),
              inArray(drawingCalibrations.status, [...CALIBRATION_LIFECYCLE.sourcesOf('supersede')])
            )
          )
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

/**
 * Withdraw one calibration: `active` becomes `withdrawn`, stamped by the
 * database's clock with who did it. Null when it is gone or no longer active
 * (compare and swap). Nothing else moves: the row it once superseded stays
 * superseded.
 */
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
