import { apiRoute, parseQuery } from '@/lib/api/handler'
import { usageQuerySchema } from '@/lib/organizations/organization-wire'
import { getUsageOverview } from '@/lib/budgets/service'

export const GET = apiRoute(
  async ({ session, request }) => getUsageOverview(session, parseQuery(request, usageQuerySchema)),
  { authz: { enforcedBy: 'getUsageOverview (canManageBudgets, else own usage only)' } }
)
