import { apiRoute } from '@/lib/api/handler'
import { moveDocumentToBin } from '@/lib/projects/document-bin'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => moveDocumentToBin(session, params.id, request),
  { authz: { enforcedBy: 'moveDocumentToBin (requireFolderWrite: project:documents:write + write on its folder)' } }
)
