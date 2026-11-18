'use client'

import { isLocale, type Locale } from '@/i18n/config'

export async function fetchOrgDefaultLocale(): Promise<Locale | null> {
  try {
    const res = await fetch('/api/organization/settings', {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    })
    if (!res.ok) return null
    const data = (await res.json()) as { settings?: { defaultLocale?: string } }
    const loc = data.settings?.defaultLocale
    return isLocale(loc) ? loc : null
  } catch {
    return null
  }
}
