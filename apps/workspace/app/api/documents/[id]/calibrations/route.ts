import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { listCalibrations, setCalibration } from '@/lib/drawing-calibrations/service'
import { listCalibrationsQuerySchema, setCalibrationRequestSchema } from '@/lib/drawing-calibrations/wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, request, params }) =>
    listCalibrations(session, params.id, parseQuery(request, listCalibrationsQuerySchema)),
  { authz: { enforcedBy: 'listCalibrations -> drawing-measure entitlement, getAccessibleDocument (read)' } }
)

export const POST = apiRoute<Params>(
  async ({ session, request, params }) =>
    setCalibration(session, params.id, await parseJsonBody(request, setCalibrationRequestSchema)),
  {
    authz: { enforcedBy: 'setCalibration -> drawing-measure entitlement, getAccessibleDocument (project:documents:write)' },
    status: 201,
  }
)
