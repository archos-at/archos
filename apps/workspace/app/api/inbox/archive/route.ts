import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { archiveAllSchema, unarchiveAllSchema } from '@/lib/inbox/inbox-wire'
import { archiveAll, unarchiveAll } from '@/lib/inbox/service'

export const POST = apiRoute(
  async ({ session, request }) => {
    await parseJsonBody(request, archiveAllSchema)
    return archiveAll(session)
  },
  { authz: { enforcedBy: 'archiveAll (rows are keyed to session.userId)' } }
)

export const DELETE = apiRoute(
  async ({ session, request }) => {
    const body = await parseJsonBody(request, unarchiveAllSchema)
    return unarchiveAll(session, body.archivedAt)
  },
  { authz: { enforcedBy: 'unarchiveAll (rows are keyed to session.userId)' } }
)
