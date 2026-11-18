import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { proposeCleanup } from '@/lib/projects/cleanup-service'
import { proposeCleanupSchema } from '@/lib/projects/cleanup-wire'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { locale } = await parseJsonBody(request, proposeCleanupSchema)
    return proposeCleanup(session, params.id, locale)
  },
  { authz: { enforcedBy: 'proposeCleanup (requireProjectAccess project:documents:write; read and write per folder)' } }
)
