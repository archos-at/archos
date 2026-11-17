import { defaultLocale, isLocale, resolveLocale, type Locale } from './config'

export type SavedLocale =
  | { known: false }
  | { known: true; locale: Locale | null }

export interface RequestLocaleInput {
  saved: SavedLocale
  cookie: string | null | undefined
  acceptLanguage: string | null | undefined
}

export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null
  for (const part of header.split(',')) {
    const tag = part.split(';')[0]?.trim()
    if (!tag) continue
    if (isLocale(tag) || isLocale(tag.split('-')[0]?.toLowerCase())) return resolveLocale(tag)
  }
  return null
}

export function pickRequestLocale({ saved, cookie, acceptLanguage }: RequestLocaleInput): Locale {
  if (saved.known) {
    return saved.locale ?? localeFromAcceptLanguage(acceptLanguage) ?? defaultLocale
  }
  if (isLocale(cookie)) return cookie
  return localeFromAcceptLanguage(acceptLanguage) ?? defaultLocale
}
