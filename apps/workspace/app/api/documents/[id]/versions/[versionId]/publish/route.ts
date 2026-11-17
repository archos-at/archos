import { apiRoute } from '@/lib/api/handler'
import { toDocumentVersionView, transitionDocumentVersion } from '@/lib/documents/lifecycle'

type Params = { id: string; versionId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const version = await transitionDocumentVersion(session, params.id, params.versionId, 'publish', {
      request,
    })
    return { version: toDocumentVersionView(version) }
  },
  { authz: { enforcedBy: 'transitionDocumentVersion(publish) -> getAccessibleDocument + requireProjectAccess (project:documents:write | project:edit)' } }
)
