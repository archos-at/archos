import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { toDocumentVersionView, transitionDocumentVersion } from '@/lib/documents/lifecycle'
import { submitRequestSchema } from '@/lib/documents/lifecycle-types'

type Params = { id: string; versionId: string }

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { reviewerUserIds, orderMessage, dueAt } = await parseJsonBody(
      request,
      submitRequestSchema,
    )
    const version = await transitionDocumentVersion(session, params.id, params.versionId, 'submit', {
      reviewerUserIds,
      orderMessage,
      dueAt,
      request,
    })
    return { version: toDocumentVersionView(version) }
  },
  { authz: { enforcedBy: 'transitionDocumentVersion(submit) -> getAccessibleDocument + requireProjectAccess (project:edit | project:documents:write)' } }
)
