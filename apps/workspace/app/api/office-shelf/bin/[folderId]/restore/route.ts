import { apiRoute } from '@/lib/api/handler'
import { OFFICE_SHELF } from '@/lib/documents/shelf'
import { restoreFolderFromBin } from '@/lib/projects/folder-bin'

type Params = { folderId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => restoreFolderFromBin(session, { shelf: OFFICE_SHELF, folderId: params.folderId }, request),
  { authz: { enforcedBy: 'restoreFolderFromBin (org:office_shelf:manage)' } }
)
