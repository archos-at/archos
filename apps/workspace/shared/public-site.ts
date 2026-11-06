/**
 * The public website's pages the app links to, and the one rule for its origin.
 *
 * The origin is configuration, never a typed domain: `LANDING_URL`
 * (`https://<webDomain>`, set by Pulumi), read on the server and handed to the
 * client through `AppConfig.publicSiteUrl`. The paths are the website's route
 * table (`apps/website/src/i18n/paths.ts`); this app's image cannot import it,
 * so `contracts/public-site.json` stands between the two and a spec on each side
 * holds its copy to that file (`public-site.spec.ts` here,
 * `apps/website/src/i18n/public-site.test.ts` there).
 *
 * Pure and client-safe. The inbound-mail bounce text uses the same origin rule
 * (`rejectText`, `@/lib/inbound-mail/contract`), as does the Email Worker.
 */

import type { Locale } from '@/i18n/config'

/** The pages, as rows of the website's `ROUTES`. Paths are copy, not identifiers. */
export const PUBLIC_SITE_PATHS = {
  projectMail: { de: '/e-mail-eingang/', en: '/en/project-mail/' },
  privacy: { de: '/datenschutz/', en: '/en/privacy/' },
} as const satisfies Record<string, Record<Locale, string>>

export type PublicSitePage = keyof typeof PUBLIC_SITE_PATHS

/**
 * The section ids the app links to, which the website keeps stable.
 */
export const PUBLIC_SITE_ANCHORS = {
  projectMail: ['dkim'],
} as const satisfies Partial<Record<PublicSitePage, readonly string[]>>

export type PublicSiteAnchor = (typeof PUBLIC_SITE_ANCHORS)[keyof typeof PUBLIC_SITE_ANCHORS][number]

/** The longest origin accepted, so the bounce text that carries it twice stays a short SMTP reply. */
export const PUBLIC_SITE_ORIGIN_MAX_LENGTH = 64

/** `http(s)://host[:port]`, ASCII, nothing after the host. */
const ORIGIN = /^https?:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*(:[0-9]{1,5})?$/i

/**
 * The website's origin from a configured value: trimmed, trailing slashes
 * dropped, or null when it is unset or not an origin (a path, a missing scheme,
 * a non-ASCII host, longer than {@link PUBLIC_SITE_ORIGIN_MAX_LENGTH}).
 */
export function publicSiteOrigin(value: string | null | undefined): string | null {
  const origin = (value ?? '').trim().replace(/\/+$/, '')
  if (origin.length > PUBLIC_SITE_ORIGIN_MAX_LENGTH || !ORIGIN.test(origin)) return null
  return origin
}

/** The address of `page` in `locale`, optionally at a section; null without an origin. */
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
