import { apiRoute, parseQuery } from '@/lib/api/handler'
import { documentSummaryQuerySchema } from '@/lib/documents/document-wire'
import {
  summarizeOfficeShelfDocuments,
  summarizePersonalShelfDocuments,
  summarizeProjectDocuments,
} from '@/lib/documents/shelf-summary'
import { shelfOf } from '@/lib/documents/shelf-scope'

export const GET = apiRoute(
  async ({ session, request }) => {
    const { scope, projectId, authoredBy, includeArchived } = parseQuery(request, documentSummaryQuerySchema)
    const shelf = shelfOf({ scope, projectId }, request, session)
    const options = { authoredBy, includeArchived: includeArchived === 'true' }
    switch (shelf.kind) {
      case 'project':
        return summarizeProjectDocuments(session, shelf.projectId, options)
      case 'personal':
        return summarizePersonalShelfDocuments(session, options)
      case 'office_shelf':
        return summarizeOfficeShelfDocuments(session, options)
    }
  },
  {
    authz: {
      enforcedBy:
        'summarizeProjectDocuments (requireProjectAccess project:view) | summarizeOfficeShelfDocuments (any member, scoped to session.organizationId) | summarizePersonalShelfDocuments (the caller’s own shelf only: shelfOf names session.userId)',
    },
  }
)
