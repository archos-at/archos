import { apiRoute } from '@/lib/api/handler'
import { restoreDocumentFromBin } from '@/lib/projects/document-bin'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => restoreDocumentFromBin(session, params.id, request),
  { authz: { enforcedBy: 'restoreDocumentFromBin -> restoreFolderFromBin (document write + write on the folder)' } }
)
