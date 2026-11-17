import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { getFolderAccess, setFolderAccess } from '@/lib/projects/folder-access-settings'
import { folderAccessSchema } from '@/lib/projects/folder-access-wire'

type Params = { id: string; folderId: string }

const enforcedBy = 'getFolderAccess/setFolderAccess -> requireProjectAccess (project:manage) + write on the folder'

export const GET = apiRoute<Params>(
  async ({ session, params }) => getFolderAccess(session, { projectId: params.id, folderId: params.folderId }),
  { authz: { enforcedBy } }
)

export const PUT = apiRoute<Params>(
  async ({ session, params, request }) => {
    const access = await parseJsonBody(request, folderAccessSchema)
    return setFolderAccess(session, { projectId: params.id, folderId: params.folderId, access }, request)
  },
  { authz: { enforcedBy } }
)
