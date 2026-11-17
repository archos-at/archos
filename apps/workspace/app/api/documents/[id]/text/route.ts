import { apiRoute } from '@/lib/api/handler'
import { doorTextOf } from '@/lib/base-knowledge/door-guard'
import { getDocumentTextPreview } from '@/lib/documents/document-delivery'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => doorTextOf(session, params.id, () => getDocumentTextPreview(session, params.id)),
  { authz: { enforcedBy: 'getDocumentTextPreview -> getAccessibleDocument (project:view)' } }
)
