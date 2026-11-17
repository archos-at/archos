/**
 * Report wrong law to the platform (ADR-0173, design §4.4 "Hotfix"): `POST
 * { countryId, workId?, editionId?, messageId?, note }` opens a draft change
 * request in that country for a platform reviewer. Thin handler; the logic
 * lives in `@/lib/base-knowledge/context/operations`.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { reportBaseKnowledge } from '@/lib/base-knowledge/context/operations'
import { baseKnowledgeReportBodySchema } from '@/lib/base-knowledge/context/operations-wire'

export const POST = apiRoute(
  async ({ session, request }) => reportBaseKnowledge(session, await parseJsonBody(request, baseKnowledgeReportBodySchema)),
  { authz: { enforcedBy: 'reportBaseKnowledge (any member, for a country the office is entitled to)' } },
)
