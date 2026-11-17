import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { deleteProjectSchema, renameProjectSchema } from '@/lib/projects/project-wire'
import { deleteProject, getProject, updateProjectName } from '@/lib/projects/service'

type Params = { id: string }

export const GET = apiRoute<Params>(async ({ session, params }) => getProject(session, params.id), {
  authz: { enforcedBy: 'getProject (requireProjectAccess project:view)' },
})

export const PATCH = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { name } = await parseJsonBody(request, renameProjectSchema)
    return updateProjectName(session, params.id, name)
  },
  { authz: { enforcedBy: 'updateProjectName (requireProjectAccess project:manage)' } }
)

export const DELETE = apiRoute<Params>(
  async ({ session, params, request }) => {
    const { confirmName } = await parseJsonBody(request, deleteProjectSchema)
    const { purgeAfter } = await deleteProject(session, params.id, confirmName, request)
    return { status: 'pending', purgeAfter: purgeAfter.toISOString() }
  },
  { status: 202, authz: { enforcedBy: 'deleteProject (requireProjectAccess project:manage)' } }
)
