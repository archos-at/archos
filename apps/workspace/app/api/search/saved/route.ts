import { apiRoute, parseJsonBody, parseQuery } from '@/lib/api/handler'
import { listProjects } from '@/lib/projects/service'
import { createSavedSearch, listSavedSearches } from '@/lib/search/saved-search-service'
import { createSavedSearchSchema, listSavedSearchesQuerySchema } from '@/lib/search/saved-search-wire'

const MEMBER_WHY =
  'a saved search is a question, never an answer: running a shared one runs as the reader with their own reach, so any member may keep and share one; rows are keyed by session.organizationId and writes by session.userId'

export const GET = apiRoute(
  async ({ session, request }) => {
    const query = parseQuery(request, listSavedSearchesQuerySchema)
    const viewableProjects = () => listProjects(session).then((projects) => new Set(projects.map((project) => project.id)))
    return listSavedSearches({ organizationId: session.organizationId, userId: session.userId }, query, viewableProjects)
  },
  { authz: { sessionOnly: true, why: MEMBER_WHY } }
)

export const POST = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, createSavedSearchSchema)
    const savedSearch = await createSavedSearch({ organizationId: session.organizationId, userId: session.userId }, input)
    return { savedSearch }
  },
  { status: 201, authz: { sessionOnly: true, why: MEMBER_WHY } }
)
