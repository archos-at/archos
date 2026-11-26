import { apiRoute, parseQuery } from '@/lib/api/handler'
import { isOfficeStandardsEnabled } from '@/lib/authz/feature-flags'
import { listDocumentsPage } from '@/lib/documents/document-listing'
import { toDocumentWireRows } from '@/lib/documents/list-projection'
import { documentListOptions, documentListQuerySchema } from '@/lib/documents/list-query'
import { shelfOf } from '@/lib/documents/shelf-scope'
import { listOfficeShelf } from '@/lib/office-shelf/service'
import { listPersonalShelf } from '@/lib/personal-shelf/service'

export const GET = apiRoute(
  async ({ session, request }) => {
    const { scope, projectId, includeStandards, ...filter } = parseQuery(request, documentListQuerySchema)
    const shelf = shelfOf({ scope, projectId }, request, session)
    const options = documentListOptions(filter)
    const { documents, ...page } =
      shelf.kind === 'project'
        ? await listDocumentsPage(session, shelf.projectId, options)
        : shelf.kind === 'personal'
          ? await listPersonalShelf(session, options)
          : await listOfficeShelf(session, { ...options, includeStandards: includeStandards === 'true' })
    const officeShelf = shelf.kind === 'office_shelf' && isOfficeStandardsEnabled(session)
    return { ...page, documents: await toDocumentWireRows(session.organizationId, documents, { officeShelf }) }
  },
  {
    authz: {
      enforcedBy:
        'listDocumentsPage (requireProjectAccess project:view) | listOfficeShelf (any member: the office shelf is org-wide shared knowledge, scoped to session.organizationId) | listPersonalShelf (the caller’s own shelf only: shelfOf names session.userId)',
    },
  }
)
