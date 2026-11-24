import 'server-only'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import type { DrawingCalibrationRow } from '@/lib/db/schema/drawing-calibrations'
import { internalRead } from '@/lib/documents/visibility'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { listDrawingCalibrations } from './repository'
import { MAX_PAGE_CALIBRATIONS, type PageCalibration } from './wire'

export const toPageCalibration = (row: DrawingCalibrationRow): PageCalibration => ({
  id: row.id,
  scope: row.scope,
  page: row.page,
  referenceSize:
    row.referenceWidthPt !== null && row.referenceHeightPt !== null
      ? { widthPt: row.referenceWidthPt, heightPt: row.referenceHeightPt }
      : null,
  region: { x: row.regionX, y: row.regionY, w: row.regionW, h: row.regionH },
  from: { x: row.pointAX, y: row.pointAY },
  to: { x: row.pointBX, y: row.pointBY },
  lengthM: row.referenceLengthM,
})

export async function activeCalibrationsOfPage(
  organizationId: string,
  target: { documentId: string; versionId: string; page: number }
): Promise<PageCalibration[]> {
  if (!(await isOrgFeatureEnabled(FEATURE_FLAGS.drawingMeasure, organizationId))) return []
  const rows = await listDrawingCalibrations(
    { organizationId, ...target, status: 'active' },
    internalRead('reloaded'),
    { limit: MAX_PAGE_CALIBRATIONS, offset: 0 }
  )
  return rows.slice(0, MAX_PAGE_CALIBRATIONS).map(toPageCalibration)
}
