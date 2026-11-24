#!/usr/bin/env node
// The overflow is measured against the width set, not `innerWidth`: with `isMobile` the layout viewport widens to fit.
// Never in a full-page capture: it resizes the viewport, `pointer: coarse` stops matching, and every target reads desktop-sized.
// A link inside a sentence is exempt from the 44px floor, as WCAG 2.5.8 exempts it.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditRoutes, inShard, judgeAgainstBaseline, parseArgs, previewRoutes, startDevServer } from './preview-audit.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const BASELINE = join(here, '../../../ci/phone-audit-baseline.json')
const PHONES = [
  { name: '390', width: 390, height: 844 },
  { name: '360', width: 360, height: 780 },
]
const MIN_TARGET_PX = 44
const PRODUCT_NAME = JSON.parse(readFileSync(join(here, '../../../packages/brand/identity.json'), 'utf8')).name
const CONCURRENCY = Math.max(1, Number(process.env.PHONE_AUDIT_CONCURRENCY ?? 3))

function measure({ width, min, productName }) {
  const INTERACTIVE =
    'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=tab], [role=checkbox], [role=radio], [role=switch], [role=menuitem], [role=option], [tabindex]:not([tabindex="-1"])'
  const root = document.documentElement
  const overflow = Math.max(root.scrollWidth, document.body?.scrollWidth ?? 0) - width
  let widest = null
  if (overflow > 0) {
    for (const el of document.body.querySelectorAll('*')) {
      const right = el.getBoundingClientRect().right
      if (right > width + 1 && (!widest || right > widest.right)) widest = { el, right }
    }
  }

  const tappable = (el) => {
    if (el.closest('[aria-hidden="true"], [inert]')) return false
    if (el.matches(':disabled, [aria-disabled="true"]')) return false
    const style = getComputedStyle(el)
    if (style.visibility === 'hidden' || style.pointerEvents === 'none' || Number(style.opacity) === 0) return false
    const box = el.getBoundingClientRect()
    return box.width > 1 && box.height > 1
  }
  const inSentence = (el) => {
    if (getComputedStyle(el).display !== 'inline') return false
    const parent = el.parentElement
    return Boolean(parent && [...parent.childNodes].some((node) => node !== el && node.nodeType === Node.TEXT_NODE && node.textContent.trim()))
  }
  const clipped = (rect, el) => {
    const out = { ...rect }
    for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) {
      const style = getComputedStyle(a)
      const clip = a.getBoundingClientRect()
      if (style.overflowX !== 'visible') Object.assign(out, { left: Math.max(out.left, clip.left), right: Math.min(out.right, clip.right) })
      if (style.overflowY !== 'visible') Object.assign(out, { top: Math.max(out.top, clip.top), bottom: Math.min(out.bottom, clip.bottom) })
    }
    return { left: out.left, top: out.top, right: Math.max(out.left, out.right), bottom: Math.max(out.top, out.bottom) }
  }
  const sizeOf = (el) => {
    const box = el.getBoundingClientRect()
    let w = box.width
    let h = box.height
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    for (const pseudo of ['::after', '::before']) {
      const part = getComputedStyle(el, pseudo)
      if (part.content === 'none' || part.position !== 'absolute' || part.pointerEvents === 'none') continue
      const pw = parseFloat(part.width) || 0
      const ph = parseFloat(part.height) || 0
      const seen = clipped({ left: cx - pw / 2, right: cx + pw / 2, top: cy - ph / 2, bottom: cy + ph / 2 }, el)
      w = Math.max(w, seen.right - seen.left)
      h = Math.max(h, seen.bottom - seen.top)
    }
    for (const label of el.labels ?? []) {
      const around = label.getBoundingClientRect()
      w = Math.max(w, around.width)
      h = Math.max(h, around.height)
    }
    const frame = el.matches('[data-citation-marker]') ? el.closest('[data-tap-reach]') : null
    const reach = frame ? Number(frame.getAttribute('data-tap-reach')) || 0 : 0
    return { w: w + 2 * reach, h: h + 2 * reach }
  }
  const nameOf = (el) => {
    const raw =
      el.getAttribute('data-testid') ||
      el.getAttribute('data-attr') ||
      el.getAttribute('aria-label') ||
      el.getAttribute('title') ||
      el.textContent ||
      el.getAttribute('name') ||
      ''
    return raw.replace(/\s+/g, ' ').trim().split(productName).join('{productName}').replace(/\d+/g, '#').slice(0, 40) || '(unnamed)'
  }

  const small = new Map()
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (!tappable(el) || inSentence(el)) continue
    const { w, h } = sizeOf(el)
    if (w >= min - 0.5 && h >= min - 0.5) continue
    const role = el.getAttribute('role')
    const key = `${el.tagName.toLowerCase()}${role ? `[${role}]` : ''} "${nameOf(el)}"`
    const seen = small.get(key)
    small.set(key, { count: (seen?.count ?? 0) + 1, sample: seen?.sample ?? `${Math.round(w)}x${Math.round(h)}` })
  }
  const culprit = widest && `${widest.el.tagName.toLowerCase()} "${nameOf(widest.el)}" to ${Math.round(widest.right)}px`
  return { overflow, culprit, small: [...small.entries()] }
}

async function warmUp(browser, base, route) {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(base + route, { waitUntil: 'networkidle', timeout: 180000 }).catch(() => {})
  await context.close().catch(() => {})
}

async function auditRoute(browser, base, route, found, unrendered) {
  await warmUp(browser, base, route)
  for (const phone of PHONES) {
    const context = await browser.newContext({ viewport: { width: phone.width, height: phone.height }, isMobile: true, hasTouch: true })
    await context.addInitScript(() => {
      if ('Notification' in window) Object.defineProperty(Notification, 'permission', { get: () => 'denied' })
    })
    const page = await context.newPage()
    try {
      const load = () => page.goto(base + route, { waitUntil: 'load', timeout: 300000 })
      const first = await load().catch(() => null)
      const response = first?.ok() ? first : await load()
      if (!response?.ok()) throw new Error(`HTTP ${response?.status() ?? 'no response'}`)
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
      await page.waitForTimeout(1000)
      await page.addStyleTag({ content: '* { content-visibility: visible !important; }' })
      await page.evaluate(() => document.querySelectorAll('nextjs-portal').forEach((node) => node.remove()))
      const { overflow, culprit, small } = await page.evaluate(measure, { width: phone.width, min: MIN_TARGET_PX, productName: PRODUCT_NAME })
      if (overflow > 0) {
        found.set(`${route} ${phone.name} overflow`, { count: 1, sample: `${overflow}px wider than the phone; widest: ${culprit}`, help: 'the page scrolls sideways' })
      }
      for (const [target, { count, sample }] of small) {
        found.set(`${route} ${phone.name} target ${target}`, { count, sample, help: `under ${MIN_TARGET_PX}x${MIN_TARGET_PX}` })
      }
    } catch (error) {
      unrendered.push(`${route} ${phone.name}: ${String(error.message).slice(0, 120)}`)
    }
    await context.close().catch(() => {})
  }
}

const args = parseArgs(process.argv.slice(2))
const discovered = previewRoutes()
const routes = inShard(args.named.length ? args.named : discovered, args.shard)
const server = process.env.PHONE_AUDIT_BASE_URL ? undefined : await startDevServer()
const base = process.env.PHONE_AUDIT_BASE_URL ?? server.origin
console.log(`measuring ${routes.length} routes at ${PHONES.map((p) => p.name).join(' and ')} against ${base}`)

const found = new Map()
const unrendered = []
try {
  await auditRoutes({
    routes,
    concurrency: CONCURRENCY,
    executablePath: process.env.PHONE_AUDIT_CHROME,
    auditRoute: (browser, route) => auditRoute(browser, base, route, found, unrendered),
  })
} finally {
  server?.stop()
}
if (unrendered.length) {
  for (const line of unrendered) console.log(`UNRENDERED ${line}`)
  console.log(`${unrendered.length} route loads failed; nothing was judged or written`)
  process.exit(1)
}
process.exit(judgeAgainstBaseline({ baseline: BASELINE, found, routes, discovered, args, title: 'phone' }))
