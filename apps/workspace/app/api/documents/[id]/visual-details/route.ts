import { apiRoute } from '@/lib/api/handler'
import { getDocumentVisualDetails } from '@/lib/documents/document-details'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => getDocumentVisualDetails(session, params.id),
  { authz: { enforcedBy: 'getDocumentVisualDetails -> getAccessibleDocument (project:view)' } }
)
