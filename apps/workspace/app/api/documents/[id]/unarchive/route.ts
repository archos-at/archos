import { apiRoute } from '@/lib/api/handler'
import { unarchiveDocument } from '@/lib/documents/unarchive'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => unarchiveDocument(session, params.id, request),
  { authz: { enforcedBy: 'unarchiveDocument -> getAccessibleDocument + requireProjectAccess (project:documents:write | project:edit)' } }
)
