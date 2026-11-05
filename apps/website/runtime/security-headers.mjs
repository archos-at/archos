/**
 * Security headers on every response of the public site, set by `server.mjs`
 * before the Astro handler runs (the handler keeps headers already set).
 *
 * The Content-Security-Policy allows the site's own origin and, only when the
 * stack has analytics on, the two PostHog origins `web-analytics.mjs` talks to.
 * What makes `script-src 'self'` hold:
 * - the build writes no inline script: `vite.build.assetsInlineLimit: 0` in
 *   `astro.config.mjs` makes Astro emit every component script as a file;
 * - JSON-LD (`type="application/ld+json"`) is data, which CSP does not block.
 * `style-src` keeps `'unsafe-inline'`: the design system's components and the
 * views set `style` attributes, which only a hash-free policy allows. Styles
 * cannot run code, so this is the accepted trade-off.
 *
 * `img-src` adds the CMS's public origin when the stack has one (ADR-0155): image covers
 * and images in a post are served in its image sizes. Only images: the site never runs
 * or fetches anything from the CMS in the browser.
 *
 * One page may be framed: the blog's preview (`/blog/preview/`, `/en/blog/preview/`),
 * by the CMS's admin panel and nobody else (`frame-ancestors` its origin). Every other
 * response keeps `frame-ancestors 'none'` and `X-Frame-Options: DENY`.
 *
 * `form-action` allows `mailto:` because the contact and demo forms hand off
 * to the visitor's mail program when JavaScript is off (README, "Forms").
 *
 * HSTS has no `includeSubDomains` and no `preload`: both reach beyond this
 * site and cannot be taken back quickly. Widening it is a decision for the
 * domain owner, at the edge.
 */

/** Two years: the value hstspreload.org asks for, should the owner ever submit the domain. */
export const HSTS = 'max-age=63072000'

/**
 * The CMS's public origin, from `CMS_PUBLIC_URL`, for `img-src`; none without a CMS.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string[]}
 */
export function cmsImageOrigins(env) {
  const url = env.CMS_URL && env.CMS_API_KEY ? env.CMS_PUBLIC_URL?.trim() : undefined
  if (!url) return []
  try {
    return [new URL(url).origin]
  } catch {
    return []
  }
}

/** The paths of the blog's preview page, the one page the CMS may frame. */
export const PREVIEW_PATHS = ['/blog/preview/', '/en/blog/preview/']

/** @param {string} pathname */
export function isPreviewPath(pathname) {
  return PREVIEW_PATHS.includes(pathname.endsWith('/') ? pathname : `${pathname}/`)
}

/**
 * @param {{ connect: string[], script: string[] }} analytics origins from `analyticsOrigins`
 * @param {string[]} [images] more image origins (`cmsImageOrigins`)
 * @param {string[]} [framers] origins that may frame the page; none by default
 * @returns {string}
 */
export function contentSecurityPolicy(analytics, images = [], framers = []) {
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", ...analytics.script],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', ...images],
    'font-src': ["'self'"],
    'media-src': ["'self'"],
    'connect-src': ["'self'", ...analytics.connect],
    'manifest-src': ["'self'"],
    // Session replay (only after consent) compresses in a worker it starts from a blob.
    'worker-src': ["'self'", ...(analytics.script.length ? ['blob:'] : [])],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'", 'mailto:'],
    'frame-ancestors': framers.length ? framers : ["'none'"],
  }
  return Object.entries(directives)
    .map(([name, sources]) => `${name} ${sources.join(' ')}`)
    .join('; ')
}

/**
 * Every security header, as `[name, value]` pairs.
 *
 * @param {{ connect: string[], script: string[] }} analytics
 * @param {string[]} [images] more image origins (`cmsImageOrigins`)
 * @param {string[]} [framers] origins that may frame the page (the preview's: `cmsImageOrigins`)
 * @returns {[string, string][]}
 */
export function securityHeaders(analytics, images = [], framers = []) {
  return [
    ['Content-Security-Policy', contentSecurityPolicy(analytics, images, framers)],
    ['Strict-Transport-Security', HSTS],
    ['X-Content-Type-Options', 'nosniff'],
    // CSP's frame-ancestors governs where both are sent; X-Frame-Options has no allow-list.
    ...(framers.length ? [] : [['X-Frame-Options', 'DENY']]),
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    [
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
    ],
  ]
}

/** The health probe's path: answered by the server itself, before Astro. */
export const HEALTH_PATH = '/healthz'
