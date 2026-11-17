/**
 * How far the base knowledge goes (ADR-0173, design §4.6): `GET ?countryId=` →
 * each entitled country's coverage level and every node that states its own.
 * Thin handler; the read lives in `@/lib/base-knowledge/context/operations`.
 */

import { apiRoute, parseQuery } from '@/lib/api/handler'
import { readCoverage } from '@/lib/base-knowledge/context/operations'
import { coverageQuerySchema } from '@/lib/base-knowledge/context/operations-wire'

export const GET = apiRoute(
  async ({ session, request }) => readCoverage(session, parseQuery(request, coverageQuerySchema)),
  { authz: { enforcedBy: 'readCoverage (any member; the office’s entitled countries only, knowledge_country_entitled)' } },
)
