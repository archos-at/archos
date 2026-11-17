export {
  locales,
  defaultLocale,
  localeNames,
  isLocale,
  resolveLocale,
  LOCALE_COOKIE,
  type Locale,
} from './config'

export {
  I18nProvider,
  useLocale,
  useTranslations,
  type I18nProviderProps,
} from './context'

export type { Translator, TranslationVars } from './translate'
export type { Dictionary } from './dictionaries'
export { namespaceRoot, translatorFor, type Namespace } from './namespace'
export { getStoreTranslator, getActiveLocale } from './store-translator'
