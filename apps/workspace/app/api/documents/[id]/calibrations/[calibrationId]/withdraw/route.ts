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
