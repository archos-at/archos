import { z } from 'zod'
import { apiRoute, parseQuery } from '@/lib/api/handler'
import { getConnectionDiagnostics } from '@/lib/budgets/service'

const querySchema = z.object({
  projectId: z.string().optional(),
})

export const GET = apiRoute(
  async ({ session, request }) =>
    getConnectionDiagnostics(session, parseQuery(request, querySchema)),
  { authz: { enforcedBy: 'getConnectionDiagnostics (scoped to session.organizationId)' } }
)
