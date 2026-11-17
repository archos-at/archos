import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { deleteSavedSearch, updateSavedSearch } from '@/lib/search/saved-search-service'
import { savedSearchParamsSchema, updateSavedSearchSchema } from '@/lib/search/saved-search-wire'
import { NotFoundError } from '@/lib/api/errors'

type Params = { id: string }

function savedSearchId(params: Params): string {
  const parsed = savedSearchParamsSchema.safeParse(params)
  if (!parsed.success) throw new NotFoundError('Saved search not found')
  return parsed.data.id
}

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const id = savedSearchId(params)
    const patch = await parseJsonBody(request, updateSavedSearchSchema)
    const savedSearch = await updateSavedSearch({ organizationId: session.organizationId, userId: session.userId }, id, patch)
    return { savedSearch }
  },
  { authz: { enforcedBy: 'updateSavedSearch (keyed by session.userId as the owner)' } }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params }) => {
    await deleteSavedSearch({ organizationId: session.organizationId, userId: session.userId }, savedSearchId(params))
  },
  { authz: { enforcedBy: 'deleteSavedSearch (keyed by session.userId as the owner)' } }
)
