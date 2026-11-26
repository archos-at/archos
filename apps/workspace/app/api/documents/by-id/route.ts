import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { byIdRequestSchema } from '@/lib/documents/by-id-types'
import { toDocumentWireRows } from '@/lib/documents/list-projection'
import { resolveShelfDocumentsById } from '@/lib/documents/resolve-by-id'
import { shelfOf } from '@/lib/documents/shelf-scope'

export const POST = apiRoute(
  async ({ session, request }) => {
    const { ids, ...selector } = await parseJsonBody(request, byIdRequestSchema)
    const documents = await resolveShelfDocumentsById(session, shelfOf(selector, request, session), ids)
    return { documents: await toDocumentWireRows(session.organizationId, documents) }
  },
  {
    authz: {
      enforcedBy:
        'resolveShelfDocumentsById: the project shelf through requireProjectAccess project:view and its hidden folders | the office shelf for any member, scoped to session.organizationId | the personal shelf, the caller’s own only (shelfOf names session.userId)',
    },
  }
)
