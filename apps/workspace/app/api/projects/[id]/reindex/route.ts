import { apiRoute } from '@/lib/api/handler'
import { reindexProject } from '@/lib/documents/reindex'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => reindexProject(session, params.id),
  { status: 202, authz: { enforcedBy: 'reindexProject -> requireProjectAccess (project:documents:write)' } }
)
