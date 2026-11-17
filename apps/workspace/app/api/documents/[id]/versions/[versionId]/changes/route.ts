import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { toDocumentVersionView, transitionDocumentVersion } from '@/lib/documents/lifecycle'
import { refuseRequestSchema } from '@/lib/documents/lifecycle-types'
import { getLocale } from '@/i18n/server'

type Params = { id: string; versionId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { comment, delegateRevision, ifMatch } = await parseJsonBody(request, refuseRequestSchema)
    const version = await transitionDocumentVersion(
      session,
      params.id,
      params.versionId,
      'request_changes',
      { comment, delegateRevision, ifMatch, request, locale: await getLocale() }
    )
    return { version: toDocumentVersionView(version) }
  },
  { authz: { enforcedBy: 'transitionDocumentVersion(request_changes) -> getAccessibleDocument + requireProjectAccess (project:edit | project:documents:write)' } }
)
