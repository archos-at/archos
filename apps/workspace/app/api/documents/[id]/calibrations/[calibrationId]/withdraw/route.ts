/**
 * Withdraw one calibration of a drawing (ADR-0183): the region reads as
 * uncalibrated again, and the calibration it had superseded stays superseded.
 * Behind the `drawing-measure` entitlement. A thin handler; the rules live in
 * `@/lib/drawing-calibrations/service`.
 */

import { apiRoute } from '@/lib/api/handler'
import { withdrawCalibration } from '@/lib/drawing-calibrations/service'

type Params = { id: string; calibrationId: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => withdrawCalibration(session, params.id, params.calibrationId),
  {
    authz: {
      enforcedBy: 'withdrawCalibration -> drawing-measure entitlement, getAccessibleDocument (project:documents:write)',
    },
  }
)
