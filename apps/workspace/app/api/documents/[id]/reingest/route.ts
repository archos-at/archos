import { apiRoute } from '@/lib/api/handler'
import { reingestDocument } from '@/lib/documents/reingest'

type Params = { id: string }

export const POST = apiRoute<Params>(
  async ({ session, params }) => reingestDocument(session, params.id),
  { authz: { enforcedBy: 'reingestDocument -> getAccessibleDocument (project:documents:write)' } }
)
