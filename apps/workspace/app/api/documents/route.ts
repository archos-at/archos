import { apiRoute, parseQuery } from '@/lib/api/handler'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { listDocumentsPage } from '@/lib/documents/document-listing'
import { toDocumentWireRows } from '@/lib/documents/list-projection'
import { documentListOptions, documentListQuerySchema } from '@/lib/documents/list-query'
import { shelfOf } from '@/lib/documents/shelf-scope'
import { listOfficeShelf } from '@/lib/office-shelf/service'

export const GET = apiRoute(
  async ({ session, request }) => {
    const { scope, projectId, includeStandards, ...filter } = parseQuery(request, documentListQuerySchema)
    const shelf = shelfOf({ scope, projectId }, request)
    const options = documentListOptions(filter)
    const { documents, ...page } =
      shelf.kind === 'project'
        ? await listDocumentsPage(session, shelf.projectId, options)
        : await listOfficeShelf(session, { ...options, includeStandards: includeStandards === 'true' })
    const officeShelf = shelf.kind !== 'project' && isOfficeStandardsEnabled(session)
    return { ...page, documents: await toDocumentWireRows(session.organizationId, documents, { officeShelf }) }
  },
  {
    authz: {
      enforcedBy:
        'listDocumentsPage (requireProjectAccess project:view) | listOfficeShelf (any member: the office shelf is org-wide shared knowledge, scoped to session.organizationId)',
    },
  }
)
