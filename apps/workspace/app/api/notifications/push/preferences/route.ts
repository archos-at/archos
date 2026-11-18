import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { pushPreferencesPatchSchema } from '@/lib/inbox/push-categories'
import { getPushPreferences, updatePushPreferences } from '@/lib/push/service'

export const GET = apiRoute(async ({ session }) => ({ preferences: await getPushPreferences(session) }), {
  authz: { sessionOnly: true, why: 'the caller’s own preferences, keyed to session.userId' },
})

export const PUT = apiRoute(
  async ({ session, request }) => {
    const patch = await parseJsonBody(request, pushPreferencesPatchSchema)
    return { preferences: await updatePushPreferences(session, patch) }
  },
  { authz: { sessionOnly: true, why: 'the caller’s own preferences, keyed to session.userId' } }
)
