import { apiRoute, parseQuery } from '@/lib/api/handler'
import { readCoverage } from '@/lib/base-knowledge/context/operations'
import { coverageQuerySchema } from '@/lib/base-knowledge/context/operations-wire'

export const GET = apiRoute(
  async ({ session, request }) => readCoverage(session, parseQuery(request, coverageQuerySchema)),
  { authz: { enforcedBy: 'readCoverage (any member; the office’s entitled countries only, knowledge_country_entitled)' } },
)
