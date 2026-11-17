import { z } from 'zod'
import { apiRoute } from '@/lib/api/handler'
import { NotFoundError } from '@/lib/api/errors'
import { removeDevice } from '@/lib/push/service'

const idSchema = z.guid()

export const DELETE = apiRoute<{ id: string }>(
  async ({ session, params }) => {
    const id = idSchema.safeParse(params.id)
    if (!id.success) throw new NotFoundError()
    await removeDevice(session, id.data)
    return { removed: true }
  },
  { authz: { enforcedBy: 'removeDevice (the row is matched on session.userId)' } }
)
