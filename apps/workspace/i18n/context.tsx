'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import {
  defaultLocale,
  isLocale,
  LEGACY_LOCALE_COOKIE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  localeNames,
  type Locale,
} from './config'
import { translatorFor, type Namespace } from './namespace'
import type { Translator } from './translate'
import { fetchUserPreferences, patchUserPreferences } from '@/lib/user-preferences/client'
import { fetchOrgDefaultLocale } from '@/lib/organizations/client'

interface I18nContextValue {
  locale: Locale
  localeNames: Record<Locale, string>
  setLocale: (locale: Locale) => void
}

const I18nContext = createContext<I18nContextValue | null>(null)

function writeLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`
  document.cookie = `${LEGACY_LOCALE_COOKIE}=; path=/; max-age=0; samesite=lax`
}

export interface I18nProviderProps {
  initialLocale: Locale
  fixedLocale?: boolean
  children: ReactNode
}

export function I18nProvider({
  initialLocale,
  fixedLocale = false,
  children,
}: I18nProviderProps): ReactNode {
  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const hydratedRef = useRef(false)
  const localeRef = useRef(initialLocale)
  localeRef.current = locale

  const applyLocale = useCallback((next: Locale): void => {
    setLocaleState(next)
    writeLocaleCookie(next)
    if (typeof document !== 'undefined') {
      document.documentElement.lang = next
    }
  }, [])

  const chosenRef = useRef(false)

  const setLocale = useCallback(
    (next: Locale): void => {
      chosenRef.current = true
      applyLocale(next)
      void patchUserPreferences({ locale: next })
    },
    [applyLocale]
  )

  useEffect(() => {
    if (fixedLocale || hydratedRef.current) return
    hydratedRef.current = true

    let cancelled = false
    void (async () => {
      const prefs = await fetchUserPreferences()
      if (cancelled || chosenRef.current) return

      if (isLocale(prefs.locale)) {
        if (prefs.locale !== localeRef.current) applyLocale(prefs.locale)
        return
      }

      const orgLocale = await fetchOrgDefaultLocale()
      if (cancelled || chosenRef.current || !isLocale(orgLocale)) return
      if (orgLocale !== localeRef.current) applyLocale(orgLocale)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const value = useMemo<I18nContextValue>(
    () => ({ locale, localeNames, setLocale }),
    [locale, setLocale]
  )

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

const OUTSIDE_PROVIDER: I18nContextValue = {
  locale: defaultLocale,
  localeNames,
  setLocale: () => {},
}

function useI18nContext(): I18nContextValue {
  return useContext(I18nContext) ?? OUTSIDE_PROVIDER
}

export function useLocale(): {
  locale: Locale
  setLocale: (locale: Locale) => void
  localeNames: Record<Locale, string>
} {
  const { locale, setLocale, localeNames: names } = useI18nContext()
  return { locale, setLocale, localeNames: names }
}

export function useTranslations(namespace: Namespace, scope?: string): Translator {
  const { locale } = useI18nContext()
  return useMemo(() => translatorFor(namespace, locale, scope), [namespace, locale, scope])
}
