import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { NotFoundError } from '@/lib/api/errors'
import { deleteProjectMemoryItem, updateProjectMemoryItem } from '@/lib/projects/memory-service'
import { patchOrgMemorySchema } from '@/lib/organizations/organization-wire'
import { toMemoryWireItem } from '@/lib/projects/project-memory-wire'
import { withOfficeTopic } from '@/lib/projects/office-memory-topics'

type Params = { itemId: string }

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const patch = await withOfficeTopic(
      session.organizationId,
      await parseJsonBody(request, patchOrgMemorySchema)
    )
    const item = await updateProjectMemoryItem(
      { organizationId: session.organizationId },
      params.itemId,
      patch
    )
    if (!item) throw new NotFoundError()
    return { item: toMemoryWireItem(item) }
  },
  {
    authz: {
      sessionOnly: true,
      why: 'org-scoped memory edit, keyed by session.organizationId; deliberately open to members like the create path',
    },
  }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params }) => {
    const deleted = await deleteProjectMemoryItem(
      { organizationId: session.organizationId },
      params.itemId
    )
    if (!deleted) throw new NotFoundError()
  },
  {
    authz: {
      sessionOnly: true,
      why: 'org-scoped memory delete, keyed by session.organizationId; deliberately open to members like the create path',
    },
  }
)
