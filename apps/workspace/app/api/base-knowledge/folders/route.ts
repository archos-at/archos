import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { asProblem } from '@/lib/base-knowledge/http/problem'
import { requireOfficeStandardsEnabled } from '@/lib/base-knowledge/office/access'
import { createBaseKnowledgeFolder, listBaseKnowledgeFolders } from '@/lib/base-knowledge/office/folders'
import { createFolderBodySchema, listFoldersQuerySchema } from '@/lib/base-knowledge/wire'

export const GET = apiRoute(
  async ({ session, request }) => asProblem(async () => {
    requireOfficeStandardsEnabled(session)
    return listBaseKnowledgeFolders(session, parseQuery(request, listFoldersQuerySchema))
  }),
  {
    authz: {
      sessionOnly: true,
      why: 'any member reads the office shelf folders; listOfficeShelfFolders scopes to session.organizationId',
    },
  },
)

export const POST = apiRoute(
  async ({ session, request }) =>
    asProblem(async () => {
      requireOfficeStandardsEnabled(session)
      return createBaseKnowledgeFolder(session, await parseJsonBody(request, createFolderBodySchema))
    }),
  { authz: { enforcedBy: 'createBaseKnowledgeFolder (canManageOfficeShelf)' }, status: 201 },
)
