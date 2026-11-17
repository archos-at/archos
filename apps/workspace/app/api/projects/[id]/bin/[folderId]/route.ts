import { apiRoute } from '@/lib/api/handler'
import { purgeFolderFromBinNow } from '@/lib/projects/folder-bin'

type Params = { id: string; folderId: string }

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) => {
    const result = await purgeFolderFromBinNow(session, { projectId: params.id, folderId: params.folderId }, request)
    return { status: result.status, counts: result.counts }
  },
  { authz: { enforcedBy: 'purgeFolderFromBinNow (project:manage; the folder readable)' } }
)
