#!/usr/bin/env node
/**
 * Screenshot a preview with every state shown at once.
 *
 * A pointer is over one thing at a time, so a capture of a page shows one
 * hover. A preview that lays a control out by state (`/dev/interaction-states`)
 * marks each cell with `data-force="hover" | "active" | "focus"`, and this
 * script forces that pseudo-class on the cell through the browser's protocol
 * (`CSS.forcePseudoState`), on all of them together. What is captured is the
 * real component under a real `:hover`, not a class that imitates one.
 * `data-force-target` narrows a cell's state to some of its descendants (one
 * tab of a strip). A pointer's state reaches a target's own descendants too,
 * so a `group-hover` inside it answers; the keys' state stays on the target.
 *
 *   node scripts/capture-forced-states.mjs <url> <out-dir> [--dark] [--parts <selector>]
 *
 * Writes `page.png` and one PNG per element matching `--parts` (default: the
 * preview's families and variants), named by its `data-family` or
 * `data-variant`. Run from `apps/workspace` against a running `next dev`, at
 * `http://localhost:<port>` (docs/ux/visual-screenshots.md). `CHROMIUM_PATH`
 * names the browser where Playwright has none of its own (a cloud session:
 * `/opt/pw-browsers/chromium`).
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright-core'

const PSEUDO = { hover: ['hover'], active: ['hover', 'active'], focus: ['focus', 'focus-visible'] }

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback)
const [url, outDir] = args.filter((arg, at) => !arg.startsWith('--') && args[at - 1] !== '--parts')
if (!url || !outDir) {
  console.error('usage: capture-forced-states.mjs <url> <out-dir> [--dark] [--parts <selector>]')
  process.exit(2)
}
const dark = flag('--dark')
const parts = option('--parts', '[data-family], [data-variant]')

/** In the page: copy each cell's state onto its targets and everything inside them. */
function markForced() {
  for (const cell of document.querySelectorAll('[data-force]')) {
    const state = cell.getAttribute('data-force')
    const target = cell.getAttribute('data-force-target')
    const roots = target ? [...cell.querySelectorAll(target)] : [cell]
    // The keys are on one element; the pointer is over an element and everything inside it.
    for (const root of roots) for (const node of state === 'focus' ? [root] : [root, ...root.querySelectorAll('*')]) node.setAttribute('data-forced', state)
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const context = await browser.newContext({ viewport: { width: 1480, height: 1000 }, deviceScaleFactor: 2, locale: 'de-DE', colorScheme: dark ? 'dark' : 'light' })
const page = await context.newPage()
await page.goto(url, { waitUntil: 'networkidle', timeout: 180_000 })
// Dark is the media query AND the class; a repaint needs its moment (docs/ux/visual-screenshots.md).
if (dark) await page.evaluate(() => document.documentElement.classList.add('dark'))
await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((node) => node.remove()))
await page.waitForTimeout(dark ? 2600 : 1000)
await page.evaluate(markForced)

const cdp = await context.newCDPSession(page)
await cdp.send('DOM.enable')
await cdp.send('CSS.enable')
const { root } = await cdp.send('DOM.getDocument', { depth: 0 })
let forced = 0
for (const [state, forcedPseudoClasses] of Object.entries(PSEUDO)) {
  const { nodeIds } = await cdp.send('DOM.querySelectorAll', { nodeId: root.nodeId, selector: `[data-forced="${state}"]` })
  for (const nodeId of nodeIds) await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses })
  forced += nodeIds.length
}
await page.waitForTimeout(500)

mkdirSync(outDir, { recursive: true })
await page.screenshot({ path: join(outDir, 'page.png'), fullPage: true })
let written = 1
for (const part of await page.locator(parts).all()) {
  const name = (await part.getAttribute('data-family')) ?? (await part.getAttribute('data-variant')) ?? `part-${written}`
  const kind = (await part.getAttribute('data-family')) ? 'family' : 'variant'
  await part.screenshot({ path: join(outDir, `${kind}-${name}.png`) })
  written += 1
}
await browser.close()
console.log(`forced ${forced} nodes, wrote ${written} images to ${outDir}`)
