import { apiRoute, parseQuery } from '@/lib/api/handler'
import { listFolderBin } from '@/lib/projects/folder-bin'
import { binListQuerySchema } from '@/lib/projects/folder-bin-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => listFolderBin(session, params.id, parseQuery(request, binListQuerySchema)),
  { authz: { enforcedBy: 'listFolderBin (project:view; each entry only when its folder is readable)' } }
)
