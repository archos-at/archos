/**
 * A person's calibration of a drawing (ADR-0183): list, set and withdraw the
 * scale of a region of a page of the version a document shows now.
 *
 * Behind the `drawing-measure` entitlement: every function here refuses, as
 * `requireFeature` does, where the organization does not hold it. Reading
 * follows the document (`getAccessibleDocument`, read); setting and
 * withdrawing need what changing the document needs (`project:documents:write`
 * through `getAccessibleDocument`, write). No permission of its own.
 *
 * A calibration belongs to ONE version: the list shows the current version's
 * rows only, and a new version starts with none.
 */

import 'server-only'
import { ConflictError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import { nextOffsetCursor, offsetPageOf } from '@/lib/api/offset-page'
import type { AuthorizedSession } from '@/lib/auth/types'
import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { FEATURE_FLAGS, isDrawingMeasureEnabled } from '@/lib/authz/feature-flags'
import type { Document } from '@/lib/db/schema/documents'
import type { DrawingCalibrationRow } from '@/lib/db/schema/drawing-calibrations'
import { getAccessibleDocument } from '@/lib/documents/access'
import { canWriteDocument } from '@/lib/documents/can-write'
import { isUuid } from '@/lib/ids'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import {
  CalibrationSetConflictError,
  findDrawingCalibration,
  listDrawingCalibrations,
  setDrawingCalibration,
  withdrawDrawingCalibration,
} from './repository'
import { toPageCalibration } from './page-read'
import {
  type CalibrationListResponse,
  type CalibrationView,
  type ListCalibrationsQuery,
  type SetCalibrationRequest,
} from './wire'

function requireEntitlement(session: AuthorizedSession): void {
  if (!isDrawingMeasureEnabled(session)) throw new FeatureDisabledError(FEATURE_FLAGS.drawingMeasure)
}

/** Whether the file is a PDF, by the type it was stored with or, failing that, by its name. */
export function isPdfDocument(doc: Pick<Document, 'contentType' | 'filename'>): boolean {
  if (doc.contentType?.toLowerCase().startsWith('application/pdf')) return true
  return doc.filename.toLowerCase().endsWith('.pdf')
}

const toView = (row: DrawingCalibrationRow): CalibrationView => ({
  ...toPageCalibration(row),
  documentId: row.documentId,
  versionId: row.versionId,
  page: row.page,
  status: row.status,
  createdBy: row.createdBy,
  createdAt: row.createdAt.toISOString(),
  withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
  withdrawnBy: row.withdrawnBy,
})

/**
 * The calibrations of the version the document shows now, oldest first, one
 * page of them. A document with no version, or one that is not a PDF, has none
 * and cannot be given one (`canCalibrate: false`).
 */
export async function listCalibrations(
  session: AuthorizedSession,
  documentId: string,
  query: ListCalibrationsQuery
): Promise<CalibrationListResponse> {
  requireEntitlement(session)
  const window = offsetPageOf(query)
  const doc = await getAccessibleDocument(session, documentId, 'read')
  const versionId = doc.publishedVersionId ?? null
  if (!versionId || !isPdfDocument(doc)) return { calibrations: [], nextCursor: null, versionId, canCalibrate: false }
  const [rows, writable] = await Promise.all([
    listDrawingCalibrations(
      {
        organizationId: session.organizationId,
        documentId: doc.id,
        versionId,
        page: query.page,
        status: query.status ?? 'active',
      },
      await shelfReaderFor(session, doc),
      window
    ),
    canWriteDocument(session, doc.id),
  ])
  return {
    calibrations: rows.slice(0, window.limit).map(toView),
    nextCursor: nextOffsetCursor(window, rows.length),
    versionId,
    canCalibrate: writable,
  }
}

/**
 * Set the calibration of a region of a page of the document's current
 * version; the region's earlier active calibration is superseded in the same
 * transaction. Refused for a file that is not a PDF (422) and for a document
 * with no version (409); two people setting one region at once is a 409 for
 * the second.
 */
export async function setCalibration(
  session: AuthorizedSession,
  documentId: string,
  input: SetCalibrationRequest
): Promise<{ calibration: CalibrationView }> {
  requireEntitlement(session)
  const doc = await getAccessibleDocument(session, documentId, 'write')
  if (!isPdfDocument(doc)) throw new UnprocessableError('Only a PDF drawing can be calibrated.')
  const versionId = doc.publishedVersionId ?? null
  if (!versionId) throw new ConflictError('This document has no version yet, so it cannot be calibrated.')
  try {
    const row = await setDrawingCalibration({
      organizationId: session.organizationId,
      documentId: doc.id,
      versionId,
      page: input.page,
      region: input.region,
      from: input.from,
      to: input.to,
      lengthM: input.lengthM,
      createdBy: session.userId,
    })
    return { calibration: toView(row) }
  } catch (error) {
    if (error instanceof CalibrationSetConflictError) {
      throw new ConflictError('Somebody calibrated this region a moment ago. Look again.')
    }
    throw error
  }
}

/**
 * Withdraw one calibration of the document. Only an active one can be
 * withdrawn (else 409), and withdrawing it does not bring back the calibration
 * it had superseded: the region is uncalibrated again.
 */
export async function withdrawCalibration(
  session: AuthorizedSession,
  documentId: string,
  calibrationId: string
): Promise<{ calibration: CalibrationView }> {
  requireEntitlement(session)
  const doc = await getAccessibleDocument(session, documentId, 'write')
  if (!isUuid(calibrationId)) throw new NotFoundError()
  const existing = await findDrawingCalibration(
    session.organizationId,
    doc.id,
    calibrationId,
    await shelfReaderFor(session, doc)
  )
  if (!existing) throw new NotFoundError()
  const withdrawn =
    existing.status === 'active'
      ? await withdrawDrawingCalibration(session.organizationId, doc.id, existing.id, session.userId)
      : null
  if (!withdrawn) throw new ConflictError('This calibration is no longer active; only an active one can be withdrawn.')
  return { calibration: toView(withdrawn) }
}
