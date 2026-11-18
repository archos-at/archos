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

export const UNLISTED_ROUTES: readonly RouteKey[] = ['firms', 'buildingLaw', 'revisions', 'blogBlocks']

function trimSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/$/, '') : path
}

export function isUnlisted(pathname: string): boolean {
  const here = trimSlash(pathname)
  return UNLISTED_ROUTES.some((key) => here === trimSlash(ROUTES[key].de) || here === trimSlash(ROUTES[key].en))
}

export function localePath(key: RouteKey, locale: Locale): string {
  return ROUTES[key][locale];
}

export function alternateOf(pathname: string): string {
  const here = trimSlash(pathname);
  for (const route of Object.values(ROUTES)) {
    if (here === trimSlash(route.de)) return route.en;
    if (here === trimSlash(route.en)) return route.de;
  }
  if (here === '/en' || here.startsWith('/en/')) return pathname.slice(3) || '/';
  return `/en${pathname}`;
}

export function localeFromUrl(url: URL): Locale {
  const first = url.pathname.split('/')[1];
  return (LOCALES as readonly string[]).includes(first) ? (first as Locale) : DEFAULT_LOCALE;
}
