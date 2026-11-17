import type { Locale } from '@/i18n/config'

export const PUBLIC_SITE_PATHS = {
  projectMail: { de: '/e-mail-eingang/', en: '/en/project-mail/' },
  privacy: { de: '/datenschutz/', en: '/en/privacy/' },
} as const satisfies Record<string, Record<Locale, string>>

export type PublicSitePage = keyof typeof PUBLIC_SITE_PATHS

export const PUBLIC_SITE_ANCHORS = {
  projectMail: ['dkim'],
} as const satisfies Partial<Record<PublicSitePage, readonly string[]>>

export type PublicSiteAnchor = (typeof PUBLIC_SITE_ANCHORS)[keyof typeof PUBLIC_SITE_ANCHORS][number]

export const PUBLIC_SITE_ORIGIN_MAX_LENGTH = 64

const ORIGIN = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]{1,5})?$/i

export function publicSiteOrigin(value: string | null | undefined): string | null {
  const origin = (value ?? '').trim().replace(/\/+$/, '')
  if (origin.length > PUBLIC_SITE_ORIGIN_MAX_LENGTH || !ORIGIN.test(origin)) return null
  return origin
}

export function publicSiteLink(
  origin: string | null | undefined,
  page: PublicSitePage,
  locale: Locale,
  anchor?: PublicSiteAnchor
): string | null {
  const base = publicSiteOrigin(origin)
  if (base === null) return null
  return `${base}${PUBLIC_SITE_PATHS[page][locale]}${anchor ? `#${anchor}` : ''}`
}
