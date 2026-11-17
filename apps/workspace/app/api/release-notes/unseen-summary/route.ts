import { apiRoute } from '@/lib/api/handler'
import { getUnseenReleaseSummary } from '@/lib/release-notes/summary-notice'

export const GET = apiRoute(async ({ session }) => ({ summary: await getUnseenReleaseSummary(session) }), {
  authz: {
    sessionOnly: true,
    why: 'the caller’s own record of which weekly summary they have seen, keyed to session.userId; the summary itself is product news, the same for every organization',
  },
})
