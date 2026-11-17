import { apiRoute } from '@/lib/api/handler'
import { archiveItem, unarchiveItem } from '@/lib/inbox/service'

export const POST = apiRoute<{ id: string }>(
  async ({ session, params }) => {
    return archiveItem(session, params.id)
  },
  { authz: { enforcedBy: 'archiveItem (rows are keyed to session.userId)' } }
)

export const DELETE = apiRoute<{ id: string }>(
  async ({ session, params }) => {
    return unarchiveItem(session, params.id)
  },
  { authz: { enforcedBy: 'unarchiveItem (rows are keyed to session.userId)' } }
)
