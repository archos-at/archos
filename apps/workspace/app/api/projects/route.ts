import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { createProjectSchema } from '@/lib/projects/create-project-schema'
import { listProjectsQuerySchema } from '@/lib/projects/project-wire'
import { projectsView } from '@/lib/projects/project-summary'
import { createProject, listProjects } from '@/lib/projects/service'

export const GET = apiRoute(
  async ({ session, request }) => {
    return projectsView(await listProjects(session), parseQuery(request, listProjectsQuerySchema))
  },
  { authz: { enforcedBy: 'listProjects (per-project FGA filter, ADR-0038)' } }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, createProjectSchema)
    return createProject(session, input, request)
  },
  { status: 201, authz: { permission: ORG_PERMISSIONS.projectsCreate } }
)
