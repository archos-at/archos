import type { Locale } from '@/i18n'
import { de } from './content/de'
import { en } from './content/en'
import { legalSlugs, type LegalContent, type LegalDocument, type LegalSlug } from './types'

const contentByLocale: Record<Locale, LegalContent> = { en, de }

export function getLegalDocument(locale: Locale, slug: LegalSlug): LegalDocument {
  return contentByLocale[locale][slug]
}

export function legalNavEntries(locale: Locale): Array<{ slug: LegalSlug; title: string }> {
  return legalSlugs.map((slug) => ({ slug, title: contentByLocale[locale][slug].title }))
}
