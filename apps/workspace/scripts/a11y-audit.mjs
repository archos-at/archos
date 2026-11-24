#!/usr/bin/env node
/**
 * Accessibility audit of the /dev preview routes: axe-core with the WCAG 2.0,
 * 2.1 and 2.2 level A and AA rule sets, light and dark, desktop and phone.
 *
 *   bun run a11y                     every /dev route; starts its own `next dev`
 *   bun run a11y -- /dev/atoms       only the routes named
 *   bun run a11y -- --shard 2/4      the second quarter of the routes (CI runs four)
 *   A11Y_BASE_URL=http://localhost:3001 bun run a11y   use a dev server that is already running
 *   A11Y_CHROME=/path/to/chrome      a Chrome or Chromium binary (default: Playwright's own,
 *                                    `bunx playwright-core install chromium`)
 *   A11Y_CONCURRENCY=3               routes audited at once
 *
 * The routes are every `app/dev/**\/page.tsx`, so a new preview is audited
 * without an edit here: an optional catch-all segment is left out and a dynamic
 * one takes `DYNAMIC_SEGMENT_SAMPLE`. The previews render real components from
 * fixtures, so the audit needs no backend; the dev server it starts gets
 * placeholder WorkOS settings (AuthKit's middleware refuses to boot without
 * them) and never signs anyone in. The /dev layout 404s outside development,
 * which is why this runs against `next dev` and not a production build.
 *
 * `scripts/a11y-pending-routes.json` lists the preview routes that existed before
 * this gate covered every route and have not been audited yet (the full run did
 * not fit the container it was set up in). They are skipped, unless named on the
 * command line; audit a few with `bun run a11y -- /dev/<route> ...`, fix or
 * baseline what they show, and delete them from the list. A new preview route is
 * never on it, so it is gated from its first commit. An entry for a route that no
 * longer exists fails the run, so the list only shrinks.
 *
 * Exits 1 on any violation not listed in `scripts/a11y-baseline.json`, and on a
 * baseline entry that no longer occurs, so the list only shrinks. Disabled
 * controls are exempt, as WCAG 2.2 SC 1.4.3 says ("inactive user interface
 * components"): axe skips them in `color-contrast` itself.
 * `--write-baseline` records the current violations instead of failing.
 */
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { auditRoutes, inShard, judgeAgainstBaseline, parseArgs, previewRoutes, startDevServer } from './preview-audit.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)
const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8')
const BASELINE = join(here, 'a11y-baseline.json')
const PENDING = join(here, 'a11y-pending-routes.json')

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
const VIEWPORTS = [
  { name: '1440', width: 1440, height: 900 },
  { name: '390', width: 390, height: 844 },
]
const CONCURRENCY = Math.max(1, Number(process.env.A11Y_CONCURRENCY ?? 3))

/**
 * One load per viewport: light is audited first, then the same page is switched
 * to dark (the media feature and the `dark` class, as the app's theme does) and
 * audited again, which halves the page loads a dev server has to serve.
 */
async function auditRoute(browser, base, route, found) {
  for (const viewport of VIEWPORTS) {
    const context = await browser.newContext({ viewport, colorScheme: 'light' })
    const page = await context.newPage()
    let scheme = 'light'
    try {
      const response = await page.goto(base + route, { waitUntil: 'load', timeout: 300000 })
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'}`)
      await page.waitForTimeout(2500)
      await page.evaluate(axeSource)
      for (scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.evaluate((dark) => {
          document.documentElement.classList.toggle('dark', dark)
          document.querySelectorAll('nextjs-portal').forEach((node) => node.remove())
        }, scheme === 'dark')
        await page.waitForTimeout(400)
        const result = await page.evaluate((tags) => globalThis.axe.run(document, { runOnly: { type: 'tag', values: tags } }), TAGS)
        for (const violation of result.violations) {
          const key = `${route} ${scheme} ${viewport.name} ${violation.id}`
          found.set(key, { count: violation.nodes.length, sample: violation.nodes[0]?.target?.join(' ') ?? '', help: violation.help })
        }
      }
    } catch (error) {
      found.set(`${route} ${scheme} ${viewport.name} load-failed`, { count: 1, sample: String(error.message).slice(0, 120), help: 'route did not render' })
    }
    await context.close().catch(() => {})
  }
}

const args = parseArgs(process.argv.slice(2))
const discovered = previewRoutes()
const pending = existsSync(PENDING) ? JSON.parse(readFileSync(PENDING, 'utf8')) : []
const all = args.named.length ? args.named : discovered.filter((route) => !pending.includes(route))
const stalePending = args.named.length ? [] : pending.filter((route) => !discovered.includes(route))
const routes = inShard(all, args.shard)
const server = process.env.A11Y_BASE_URL ? undefined : await startDevServer()
const base = process.env.A11Y_BASE_URL ?? server.origin
console.log(`auditing ${routes.length} of ${all.length} routes against ${base}; ${args.named.length ? 0 : pending.length} pending (scripts/a11y-pending-routes.json)`)

const found = new Map()
try {
  await auditRoutes({
    routes,
    concurrency: CONCURRENCY,
    executablePath: process.env.A11Y_CHROME,
    auditRoute: (browser, route) => auditRoute(browser, base, route, found),
  })
} finally {
  server?.stop()
}
process.exit(
  judgeAgainstBaseline({ baseline: BASELINE, found, routes, discovered, args, title: 'a11y', stalePending, pendingFile: 'scripts/a11y-pending-routes.json' }),
)
