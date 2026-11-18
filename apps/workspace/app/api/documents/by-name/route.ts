import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { resolveProjectDocumentsByName } from '@/lib/documents/document-listing'
import { toDocumentWireRows } from '@/lib/documents/list-projection'
import { byNameRequestSchema } from '@/lib/documents/by-name-types'
import { shelfOf } from '@/lib/documents/shelf-scope'
import { resolveOfficeShelfDocumentsByName } from '@/lib/office-shelf/service'

export const POST = apiRoute(
  async ({ session, request }) => {
    const { names, ...selector } = await parseJsonBody(request, byNameRequestSchema)
    const shelf = shelfOf(selector, request)
    const documents =
      shelf.kind === 'project'
        ? await resolveProjectDocumentsByName(session, shelf.projectId, names)
        : await resolveOfficeShelfDocumentsByName(session, names)
    return { documents: await toDocumentWireRows(session.organizationId, documents) }
  },
  {
    authz: {
      enforcedBy:
        'resolveProjectDocumentsByName (requireProjectAccess project:view) | resolveOfficeShelfDocumentsByName (any member, scoped to session.organizationId)',
    },
  }
)
