import { apiRoute } from '@/lib/api/handler'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { purgeFolderFromBinNow } from '@/lib/projects/folder-bin'

type Params = { folderId: string }

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) => {
    const result = await purgeFolderFromBinNow(session, { shelf: OFFICE_SHELF, folderId: params.folderId }, request)
    return { status: result.status, counts: result.counts }
  },
  { authz: { enforcedBy: 'purgeFolderFromBinNow (org:office_shelf:manage; refused under a legal hold)' } }
)
