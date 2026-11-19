import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { listProjectNorms, placeProjectNorms } from '@/lib/office-shelf/project-norms/service'
import { listProjectNormsQuerySchema, placeProjectNormsBodySchema } from '@/lib/office-shelf/project-norms/wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    requireOfficeStandardsEnabled(session)
    return listProjectNorms(session, params.id, parseQuery(request, listProjectNormsQuerySchema))
  },
  { authz: { enforcedBy: 'listProjectNorms (requireShelfRead: project:view; the folder visible to the reader)' } }
)

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    requireOfficeStandardsEnabled(session)
    return placeProjectNorms(session, params.id, await parseJsonBody(request, placeProjectNormsBodySchema), request)
  },
  {
    authz: {
      enforcedBy:
        'placeProjectNorms (getAccessibleDocument write: project:documents:write | project:edit and write on the folder; ' +
        'office_shelf also canManageOfficeShelf)',
    },
  }
)
