import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { releaseNoticePreferenceBodySchema } from '@/lib/release-notes/release-notes-wire'
import { getReleaseNoticePreference, setReleaseNoticePreference } from '@/lib/release-notes/summary-notice'

export const GET = apiRoute(async ({ session }) => getReleaseNoticePreference(session), {
  authz: { sessionOnly: true, why: 'the caller’s own notice preference, keyed to session.userId' },
})

export const PUT = apiRoute(
  async ({ session, request }) => {
    const { enabled } = await parseJsonBody(request, releaseNoticePreferenceBodySchema)
    return setReleaseNoticePreference(session, enabled)
  },
  {
    authz: {
      sessionOnly: true,
      why: 'the caller’s own notice preference, keyed to session.userId; nobody else’s row is reachable',
    },
  }
)
