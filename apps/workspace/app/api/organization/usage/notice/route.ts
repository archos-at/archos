import { apiRoute, parseQuery } from '@/lib/api/handler'
import { getChatUsageNotice } from '@/lib/budgets/service'
import { usageNoticeQuerySchema } from '@/lib/organizations/organization-wire'

export const GET = apiRoute(
  async ({ session, request }) => ({ notice: await getChatUsageNotice(session, parseQuery(request, usageNoticeQuerySchema)) }),
  { authz: { enforcedBy: 'getChatUsageNotice (project:view on the project, canManageBudgets for amounts)' } }
)
