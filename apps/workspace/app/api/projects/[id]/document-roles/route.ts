import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { declareDocumentRole, listDocumentRoles } from '@/lib/document-roles/service'
import { loadMissingDocuments } from '@/lib/document-roles/prompt-loader'
import { declareDocumentRoleSchema } from '@/lib/document-roles/role-wire'

type Params = { id: string }

export const GET = apiRoute<Params>(
  async ({ session, params }) => ({
    roles: await listDocumentRoles(params.id, session),
    missing: await loadMissingDocuments(params.id, session.organizationId),
  }),
  { authz: { enforcedBy: 'listDocumentRoles (requireProjectAccess project:view)' } }
)

export const POST = apiRoute<Params>(
  async ({ session, params, request }) => {
    const body = await parseJsonBody(request, declareDocumentRoleSchema)
    return declareDocumentRole({ projectId: params.id, ...body }, session)
  },
  {
    status: 201,
    authz: {
      enforcedBy: 'declareDocumentRole (requireProjectAccess project:documents:write)',
    },
  }
)
