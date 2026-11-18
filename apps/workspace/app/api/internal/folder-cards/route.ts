import { NotFoundError } from '@/lib/api/errors'
import { internalApiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { withTenant } from '@/lib/db/tenant-context'
import { deleteFolderCard, findCardFolder, getFolderCards, upsertFolderCard } from '@/lib/folder-cards/repository'
import {
  deleteFolderCardQuerySchema,
  getFolderCardsQuerySchema,
  putFolderCardRequestSchema,
  type GetFolderCardsResponse,
  type PutFolderCardResponse,
} from '@/lib/folder-cards/types'

const TENANCY = { tenancy: { fromPayload: 'organization_id in the body or query, the organization the card is built for' } }

const folderNotFound = () => new NotFoundError('No folder with that path in that collection.')

export const PUT = internalApiRoute(
  'folder-cards',
  async ({ request }): Promise<PutFolderCardResponse> => {
    const body = await parseJsonBody(request, putFolderCardRequestSchema)
    return withTenant({ organizationId: body.organization_id }, async () => {
      const folder = await findCardFolder(body.organization_id, body.collection, body.folder_path)
      if (!folder) throw folderNotFound()
      await upsertFolderCard(body.organization_id, folder, body)
      return { folder_id: folder.folderId, status: body.status }
    })
  },
  TENANCY,
)

export const GET = internalApiRoute(
  'folder-cards',
  async ({ request }): Promise<GetFolderCardsResponse> => {
    const { organization_id, collection } = parseQuery(request, getFolderCardsQuerySchema)
    return withTenant({ organizationId: organization_id }, () => getFolderCards(organization_id, collection))
  },
  TENANCY,
)

export const DELETE = internalApiRoute(
  'folder-cards',
  async ({ request }): Promise<{ deleted: boolean }> => {
    const { organization_id, collection, folder_path } = parseQuery(request, deleteFolderCardQuerySchema)
    return withTenant({ organizationId: organization_id }, async () => {
      const folder = await findCardFolder(organization_id, collection, folder_path)
      if (!folder) throw folderNotFound()
      return { deleted: await deleteFolderCard(organization_id, folder) }
    })
  },
  TENANCY,
)
