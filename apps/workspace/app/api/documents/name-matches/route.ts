import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { probeProjectDocumentNames } from '@/lib/documents/document-listing'
import { nameProbeRequestSchema, type NameProbeResponse } from '@/lib/documents/name-probe-types'
import { shelfOf } from '@/lib/documents/shelf-scope'
import { probeOfficeShelfDocumentNames } from '@/lib/office-shelf/service'
import { probePersonalShelfDocumentNames } from '@/lib/personal-shelf/service'

export const POST = apiRoute(
  async ({ session, request }): Promise<NameProbeResponse> => {
    const { names, ...selector } = await parseJsonBody(request, nameProbeRequestSchema)
    const shelf = shelfOf(selector, request, session)
    return {
      documents:
        shelf.kind === 'project'
          ? await probeProjectDocumentNames(session, shelf.projectId, names)
          : shelf.kind === 'personal'
            ? await probePersonalShelfDocumentNames(session, names)
            : await probeOfficeShelfDocumentNames(session, names),
    }
  },
  {
    authz: {
      enforcedBy:
        'probeProjectDocumentNames (requireProjectAccess project:view) | probeOfficeShelfDocumentNames (any member, scoped to session.organizationId) | probePersonalShelfDocumentNames (the caller’s own shelf only: shelfOf names session.userId)',
    },
  }
)
