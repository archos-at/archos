import { apiRoute, parseQuery } from '@/lib/api/handler'
import { getProjectDocumentFindings } from '@/lib/documents/findings-service'
import { documentFindingsQuerySchema } from '@/lib/documents/findings-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { documentId } = parseQuery(request, documentFindingsQuerySchema)
    return getProjectDocumentFindings(session, params.id, documentId)
  },
  { authz: { enforcedBy: 'getProjectDocumentFindings → listDocumentsPage (requireProjectAccess project:view)' } }
)
