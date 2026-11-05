/**
 * Record that this person has seen a week's release-notes summary, so the "Neu diese Woche"
 * notice does not show it again on any device (ADR-0154, amendment). Never moves backwards.
 *
 * POST — any signed-in member, about themselves: the record is keyed to session.userId.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { releaseSummarySeenBodySchema } from '@/lib/release-notes/release-notes-wire'
import { markReleaseSummarySeen } from '@/lib/release-notes/summary-notice'

export const POST = apiRoute(
  async ({ session, request }) => {
    const { week } = await parseJsonBody(request, releaseSummarySeenBodySchema)
    return markReleaseSummarySeen(session, week)
  },
  {
    authz: {
      sessionOnly: true,
      why: 'the caller’s own record of which weekly summary they have seen, keyed to session.userId; nobody else’s row is reachable',
    },
  }
)
