import { NotFoundError } from '@/lib/api/errors'
import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { decideFolderNorms, listFolderNorms } from '@/lib/base-knowledge/office/folder-norms'
import {
  decideFolderNormsBodySchema,
  folderNormsParamsSchema,
  listFolderNormsQuerySchema,
} from '@/lib/office-shelf/folder-norms-wire'

type Params = { folderId: string }

function folderIdOf(params: Params): string {
  const parsed = folderNormsParamsSchema.safeParse(params)
  if (!parsed.success) throw new NotFoundError()
  return parsed.data.folderId
}

export const GET = apiRoute<Params>(
  async ({ session, params, request }) =>
    listFolderNorms(session, folderIdOf(params), parseQuery(request, listFolderNormsQuerySchema)),
  { authz: { enforcedBy: 'listFolderNorms (office-standards, canManageOfficeShelf)' } },
)

export const POST = apiRoute<Params>(
  async ({ session, params, request }) =>
    decideFolderNorms(session, folderIdOf(params), await parseJsonBody(request, decideFolderNormsBodySchema)),
  { authz: { enforcedBy: 'decideFolderNorms (office-standards, canManageOfficeShelf)' } },
)
