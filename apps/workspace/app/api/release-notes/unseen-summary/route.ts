/**
 * The newest weekly release-notes summary this person has not seen yet (ADR-0154, amendment):
 * what the "Neu diese Woche" notice shows. `{ summary: null }` once they have seen it, or when the
 * newest week has no summary.
 *
 * GET — any signed-in member, about themselves: the record is keyed to session.userId.
 */

import { apiRoute } from '@/lib/api/handler'
import { getUnseenReleaseSummary } from '@/lib/release-notes/summary-notice'

export const GET = apiRoute(async ({ session }) => ({ summary: await getUnseenReleaseSummary(session) }), {
  authz: {
    sessionOnly: true,
    why: 'the caller’s own record of which weekly summary they have seen, keyed to session.userId; the summary itself is product news, the same for every organization',
  },
})
