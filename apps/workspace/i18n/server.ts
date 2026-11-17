import 'server-only'
import { cache } from 'react'
import { cookies, headers } from 'next/headers'
import { LEGACY_LOCALE_COOKIE, LOCALE_COOKIE, defaultLocale, type Locale } from './config'
import { translatorFor, type Namespace } from './namespace'
import { pickRequestLocale } from './request-locale'
import type { Translator } from './translate'
import { findSavedLocale } from '@/lib/user-preferences/locale'
import { actingReaderIsAgent } from '@/lib/agent-api/acting-session'
import { inJobSlice } from '@/lib/jobs-queue/slice-scope'

const requestLocale = cache(async (): Promise<Locale> => {
  const [cookieStore, headerStore, saved] = await Promise.all([cookies(), headers(), findSavedLocale()])
  return pickRequestLocale({
    saved,
    cookie: (cookieStore.get(LOCALE_COOKIE) ?? cookieStore.get(LEGACY_LOCALE_COOKIE))?.value,
    acceptLanguage: headerStore.get('accept-language'),
  })
})

export async function getLocale(): Promise<Locale> {
  if (actingReaderIsAgent()) return 'en'
  if (inJobSlice()) return defaultLocale
  return requestLocale()
}

export async function getTranslations(namespace: Namespace, scope?: string): Promise<Translator> {
  return translatorFor(namespace, await getLocale(), scope)
}
