import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { budgetDeleteSchema, budgetPutSchema } from '@/lib/organizations/organization-wire'
import { getBudgetOverview, removeBudgetPolicy, saveBudgetPolicy } from '@/lib/budgets/service'

export const GET = apiRoute(async ({ session }) => getBudgetOverview(session), {
  authz: { enforcedBy: 'getBudgetOverview (canManageBudgets, else own-limits only)' },
})

export const PUT = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, budgetPutSchema)
    return { policy: await saveBudgetPolicy(session, input, request) }
  },
  {
    status: 201,
    authz: {
      enforcedBy: 'saveBudgetPolicy (canManageBudgets or project:manage for project scope)',
    },
  }
)

export const DELETE = apiRoute(
  async ({ session, request }) => {
    const input = await parseJsonBody(request, budgetDeleteSchema)
    return { removed: await removeBudgetPolicy(session, input, request) }
  },
  {
    authz: {
      enforcedBy: 'removeBudgetPolicy (canManageBudgets or project:manage for project scope)',
    },
  }
)
