/**
 * The one table of routes. Every page path, the language switch, hreflang and
 * the navigation read it. A route is one row: the German path and the English
 * path. The English site spells its segments in English (`/en/security`), so
 * the rows are not a prefix rule.
 *
 * Pure and import-free on purpose: nothing here depends on Astro.
 */
export const LOCALES = ['de', 'en'] as const

export type Locale = (typeof LOCALES)[number]

export const DEFAULT_LOCALE: Locale = 'de'

export const ROUTES = {
  home: { de: '/', en: '/en/' },
  firms: { de: '/ki-fuer-architekturbueros/', en: '/en/ai-for-architecture-firms/' },
  buildingLaw: { de: '/baurecht/', en: '/en/building-law/' },
  revisions: { de: '/planstaende-vergleichen/', en: '/en/comparing-plan-revisions/' },
  security: { de: '/datensicherheit/', en: '/en/security/' },
  projectMail: { de: '/e-mail-eingang/', en: '/en/project-mail/' },
  blog: { de: '/blog/', en: '/en/blog/' },
  contact: { de: '/kontakt/', en: '/en/contact/' },
  imprint: { de: '/impressum/', en: '/en/imprint/' },
  privacy: { de: '/datenschutz/', en: '/en/privacy/' },
  demo: { de: '/demo/', en: '/en/demo/' },
  changelog: { de: '/changelog/', en: '/en/changelog/' },
  blogBlocks: { de: '/blog-bausteine/', en: '/en/blog-blocks/' },
} as const satisfies Record<string, Record<Locale, string>>

export type RouteKey = keyof typeof ROUTES

/**
 * Pages that are built and answer at their address, but that the site does not offer: no
 * link in the navigation, the footer, another page or `llms.txt`, no sitemap entry, and
 * `noindex` (BaseLayout reads this list). Old addresses may still redirect to them
 * (redirects.mjs). Owner decision 2026-11-05: the three product sub pages are taken off
 * the site but kept until it is decided what replaces them. `blogBlocks` shows every post block
 * with example content, for the editors and for review; it is not a page for visitors. Moving a
 * key back out of this list offers the page again everywhere.
 */
export const UNLISTED_ROUTES: readonly RouteKey[] = ['firms', 'buildingLaw', 'revisions', 'blogBlocks']

/** `/blog/` and `/blog` are the same page: the site builds directory URLs. */
function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

/** Whether `pathname` is one of the unlisted pages, in either locale. */
export function isUnlisted(pathname: string): boolean {
  const here = trimSlash(pathname)
  return UNLISTED_ROUTES.some((key) => here === trimSlash(ROUTES[key].de) || here === trimSlash(ROUTES[key].en))
}

/** The path of route `key` in `locale`, with its trailing slash as the table gives it. */
export function localePath(key: RouteKey, locale: Locale): string {
  return ROUTES[key][locale];
}

/**
 * The same page in the other locale. A path in the table maps through its
 * row. A path outside the table only gets the `/en` prefix added or removed,
 * which is right for pages that do not translate a segment (for example a
 * future `/blog/<slug>/`). A page that does translate a segment must have a row.
 */
export function alternateOf(pathname: string): string {
  const here = trimSlash(pathname);
  for (const route of Object.values(ROUTES)) {
    if (here === trimSlash(route.de)) return route.en;
    if (here === trimSlash(route.en)) return route.de;
  }
  if (here === '/en' || here.startsWith('/en/')) return pathname.slice(3) || '/';
  return `/en${pathname}`;
}

/** The locale a URL belongs to: `/en` and everything under it is English, the rest German. */
export function localeFromUrl(url: URL): Locale {
  const first = url.pathname.split('/')[1];
  return (LOCALES as readonly string[]).includes(first) ? (first as Locale) : DEFAULT_LOCALE;
}
