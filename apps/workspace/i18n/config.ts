export const locales = ['en', 'de'] as const

export type Locale = (typeof locales)[number]

export const defaultLocale: Locale = 'en'

export const LOCALE_COOKIE = 'locale'

export const LEGACY_LOCALE_COOKIE = 'grid-locale'

export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export const localeNames: Record<Locale, string> = {
  en: 'English',
  de: 'Deutsch',
}

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value)
}

export function resolveLocale(value: unknown): Locale {
  if (isLocale(value)) return value
  if (typeof value === 'string') {
    const primary = value.split('-')[0]?.toLowerCase()
    if (isLocale(primary)) return primary
  }
  return defaultLocale
}
