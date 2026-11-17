import { z } from 'zod'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { NotFoundError } from '@/lib/api/errors'
import { editPersonalMemoryItem, removePersonalMemoryItem } from '@/lib/personal-memory/service'
import { patchPersonalMemorySchema } from '@/lib/personal-memory/wire'

type Params = { itemId: string }

const WHY = 'the caller’s own note, keyed to session.userId and held by row-level security on the person'

function noteId(params: Params): string {
  const parsed = z.guid().safeParse(params.itemId)
  if (!parsed.success) throw new NotFoundError()
  return parsed.data
}

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const patch = await parseJsonBody(request, patchPersonalMemorySchema)
    const item = await editPersonalMemoryItem(
      { organizationId: session.organizationId, userId: session.userId },
      noteId(params),
      patch
    )
    if (!item) throw new NotFoundError()
    return { item }
  },
  { authz: { sessionOnly: true, why: WHY } }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params }) => {
    const removed = await removePersonalMemoryItem(
      { organizationId: session.organizationId, userId: session.userId },
      noteId(params)
    )
    if (!removed) throw new NotFoundError()
  },
  { authz: { sessionOnly: true, why: WHY } }
)
