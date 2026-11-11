/**
 * Knowledge-base API: what the base corpus holds for the session's office, the
 * files released in a country it is entitled to (ADR-0173). Thin handler; the
 * rule lives in `@/lib/knowledge/released-corpus`. Platform operators list the
 * whole corpus through `GET /api/platform/knowledge/documents`.
 */

import { apiRoute } from '@/lib/api/handler'
import { getKnowledgeBaseStatusFor } from '@/lib/knowledge/released-corpus'

export const GET = apiRoute(async ({ session }) => getKnowledgeBaseStatusFor(session), {
  authz: {
    sessionOnly: true,
    why: 'needs no permission: every member reads the base corpus. Which files are listed is decided in the service, by the office’s entitled countries and each file’s release mark (lib/knowledge/released-corpus.ts)',
  },
})
