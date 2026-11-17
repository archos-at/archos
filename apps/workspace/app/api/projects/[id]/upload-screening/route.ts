import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { projectScreeningOverrideSchema } from '@/lib/upload-screening/project-policy'
import { getProjectUploadScreening, saveProjectUploadScreening } from '@/lib/upload-screening/project-service'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => getProjectUploadScreening(session, params.id),
  { authz: { enforcedBy: 'getProjectUploadScreening -> requireProjectAccess (project:view)' } }
)

export const PUT = apiRoute<Params>(
  async ({ session, params, request }) => {
    const override = await parseJsonBody(request, projectScreeningOverrideSchema)
    return saveProjectUploadScreening(session, params.id, override, request)
  },
  { authz: { enforcedBy: 'saveProjectUploadScreening -> requireProjectAccess (project:manage)' } }
)
