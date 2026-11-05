/**
 * Whether this person is shown the newest weekly release-notes summary in a notice (ADR-0154,
 * amendment): the switch on the profile page, and what "Nicht mehr anzeigen" turns off.
 *
 * GET — any signed-in member, about themselves.
 * PUT — any signed-in member, about themselves. Turning it back on resumes with the next week.
 */

import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { releaseNoticePreferenceBodySchema } from '@/lib/release-notes/release-notes-wire'
import { getReleaseNoticePreference, setReleaseNoticePreference } from '@/lib/release-notes/summary-notice'

const OWN = {
  sessionOnly: true,
  why: 'the caller’s own notice preference, keyed to session.userId; nobody else’s row is reachable',
} as const

export const GET = apiRoute(async ({ session }) => getReleaseNoticePreference(session), { authz: OWN })

export const PUT = apiRoute(
  async ({ session, request }) => {
    const { enabled } = await parseJsonBody(request, releaseNoticePreferenceBodySchema)
    return setReleaseNoticePreference(session, enabled)
  },
  { authz: OWN }
)
