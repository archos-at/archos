import 'server-only'
import { captureServer, type ServerEvent } from '@/lib/analytics/posthog-server'
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
import { RegionOverlapsError } from './errors'
import {
  CalibrationRegionOverlapError,
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

function captured(
  session: AuthorizedSession,
  event: Extract<ServerEvent, 'drawing_calibration_set' | 'drawing_calibration_withdrawn'>,
  documentId: string,
  page: number
): void {
  captureServer({
    event,
    distinctId: session.userId,
    organizationId: session.organizationId,
    properties: { document_id: documentId, page },
  })
}

function requireEntitlement(session: AuthorizedSession): void {
  if (!isDrawingMeasureEnabled(session)) throw new FeatureDisabledError(FEATURE_FLAGS.drawingMeasure)
}

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
    captured(session, 'drawing_calibration_set', doc.id, row.page)
    return { calibration: toView(row) }
  } catch (error) {
    if (error instanceof CalibrationRegionOverlapError) throw new RegionOverlapsError(toView(error.overlapping))
    if (error instanceof CalibrationSetConflictError) {
      throw new ConflictError('Somebody calibrated this region a moment ago. Look again.')
    }
    throw error
  }
}

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
  captured(session, 'drawing_calibration_withdrawn', doc.id, withdrawn.page)
  return { calibration: toView(withdrawn) }
}
