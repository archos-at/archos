import { apiRoute, parseQuery } from '@/lib/api/handler'
import { projectShelf } from '@/lib/documents/shelf'
import { listFolderBin } from '@/lib/projects/folder-bin'
import { binListQuerySchema } from '@/lib/projects/folder-bin-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => listFolderBin(session, projectShelf(params.id), parseQuery(request, binListQuerySchema)),
  { authz: { enforcedBy: 'listFolderBin (project:view; each entry only when its folder is readable)' } }
)
