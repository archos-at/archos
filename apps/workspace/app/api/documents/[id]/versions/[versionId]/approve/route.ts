import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { toDocumentVersionView, transitionDocumentVersion } from '@/lib/documents/lifecycle'
import { approveRequestSchema } from '@/lib/documents/lifecycle-types'

type Params = { id: string; versionId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { comment, ifMatch } = await parseJsonBody(request, approveRequestSchema)
    const version = await transitionDocumentVersion(session, params.id, params.versionId, 'approve', {
      comment,
      ifMatch,
      request,
    })
    return { version: toDocumentVersionView(version) }
  },
  { authz: { enforcedBy: 'transitionDocumentVersion(approve) -> getAccessibleDocument + requireProjectAccess (project:edit | project:documents:write)' } }
)
