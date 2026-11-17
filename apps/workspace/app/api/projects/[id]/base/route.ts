import { apiRoute, parseQuery } from '@/lib/api/handler'
import { readProjectBase } from '@/lib/base-knowledge/context/operations'
import { projectBaseQuerySchema } from '@/lib/base-knowledge/context/operations-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => readProjectBase(session, params.id, parseQuery(request, projectBaseQuerySchema).asOf),
  { authz: { enforcedBy: 'readProjectBase (requireProjectAccess project:view)' } },
)
