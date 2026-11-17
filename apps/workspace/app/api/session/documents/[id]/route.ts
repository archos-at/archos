import { apiRoute } from '@/lib/api/handler'
import { deleteSessionDocument } from '@/lib/session-documents/service'

export const DELETE = apiRoute<{ id: string }>(
  async ({ session, params, request }) => {
    await deleteSessionDocument(session, params.id, request)
    return null
  },
  {
    authz: {
      enforcedBy: 'deleteSessionDocument (requireResourceAccess conversation:collaborator)',
    },
  },
)
