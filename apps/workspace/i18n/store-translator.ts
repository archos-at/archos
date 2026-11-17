import { translatorFor, type Namespace } from './namespace'
import type { Translator } from './translate'
import { LEGACY_LOCALE_COOKIE, LOCALE_COOKIE, defaultLocale, isLocale, resolveLocale, type Locale } from './config'

export function getActiveLocale(): Locale {
  if (typeof document === 'undefined') return defaultLocale
  const pageLang = document.documentElement.lang
  if (isLocale(pageLang)) return pageLang
  const cookies = document.cookie.split(';').map((pair) => pair.trim())
  const read = (name: string) => cookies.find((pair) => pair.startsWith(`${name}=`))?.slice(name.length + 1)
  const value = read(LOCALE_COOKIE) ?? read(LEGACY_LOCALE_COOKIE)
  return resolveLocale(value ? decodeURIComponent(value) : undefined)
}

export function getStoreTranslator(namespace: Namespace, scope?: string): Translator {
  return translatorFor(namespace, getActiveLocale(), scope)
}
