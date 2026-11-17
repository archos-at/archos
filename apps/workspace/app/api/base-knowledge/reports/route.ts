import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { reportBaseKnowledge } from '@/lib/base-knowledge/context/operations'
import { baseKnowledgeReportBodySchema } from '@/lib/base-knowledge/context/operations-wire'

export const POST = apiRoute(
  async ({ session, request }) => reportBaseKnowledge(session, await parseJsonBody(request, baseKnowledgeReportBodySchema)),
  { authz: { enforcedBy: 'reportBaseKnowledge (any member, for a country the office is entitled to)' } },
)
