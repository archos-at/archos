import { cookies } from 'next/headers'
import { apiRoute, parseJsonBody } from '@/lib/api/handler'
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, isLocale } from '@/i18n/config'
import { updatePreferencesSchema } from '@/lib/user-preferences/preferences-wire'
import { getUserPreferences, mergeUserPreferences } from '@/lib/user-preferences/service'

export const GET = apiRoute(async ({ session }) => ({ prefs: await getUserPreferences(session) }), {
  authz: { sessionOnly: true, why: 'the caller’s own preferences, keyed to session.userId' },
})

export const POST = apiRoute(
  async ({ session, request }) => {
    const { prefs } = await parseJsonBody(request, updatePreferencesSchema)
    const merged = await mergeUserPreferences(session, prefs)
    if (isLocale(prefs.locale)) {
      const jar = await cookies()
      jar.set(LOCALE_COOKIE, prefs.locale, {
        path: '/',
        maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
        sameSite: 'lax',
      })
    }
    return { prefs: merged }
  },
  { authz: { sessionOnly: true, why: 'the caller’s own preferences, keyed to session.userId' } }
)
