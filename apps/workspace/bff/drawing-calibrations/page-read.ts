/**
 * The calibrations the agent's measuring tool is given for one page
 * (`GET /api/internal/document-file?calibrationsPage=`). Its own module, so
 * the internal route does not pull in the person-facing service and the
 * session code behind it.
 */

import 'server-only'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import type { DrawingCalibrationRow } from '@/lib/db/schema/drawing-calibrations'
import { internalRead } from '@/lib/documents/visibility'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { listDrawingCalibrations } from './repository'
import { MAX_PAGE_CALIBRATIONS, type PageCalibration } from './wire'

export const toPageCalibration = (row: DrawingCalibrationRow): PageCalibration => ({
  id: row.id,
  region: { x: row.regionX, y: row.regionY, w: row.regionW, h: row.regionH },
  from: { x: row.pointAX, y: row.pointAY },
  to: { x: row.pointBX, y: row.pointBY },
  lengthM: row.referenceLengthM,
})

/**
 * The active calibrations of one page of one version: at most
 * {@link MAX_PAGE_CALIBRATIONS}, oldest first, and none where the organization
 * does not hold the `drawing-measure` entitlement (asked per organization: an
 * internal route has no session whose claim could say). No person is asked
 * either: the route resolved the document under the turn's signed scope a
 * moment ago, in the tenant scope this runs in.
 */
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
