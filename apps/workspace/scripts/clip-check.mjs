#!/usr/bin/env node
/**
 * Nothing cut off: walks the states of a preview route at five widths and flags
 *
 *   cut-text            text cut by its box (ellipsis, a clamp, overflow hidden) whose whole text is not reachable as
 *                       a title or an accessible name on it or an ancestor;
 *   h-scroll            a box that scrolls sideways, hiding what is past its edge;
 *   off-screen          a button, link or field past the viewport's side;
 *   clipped-edge        a sheet's 12% edge (a ring OUTSIDE its box, `0 0 0 1px`) cut by an ancestor that clips at the box;
 *   edge-painted-over   a band with a fill of its own (a sticky row) painted over a sheet's edge.
 *
 *   node scripts/clip-check.mjs                         Dateien's real-project states (`/dev/files-page?project=real`)
 *   node scripts/clip-check.mjs '/dev/x?a=1' '/dev/y'   the routes named
 *   node scripts/clip-check.mjs --base=http://localhost:3420   a dev server on another port (default 3000)
 *   node scripts/clip-check.mjs --chrome=/path/to/chrome       a Chrome or Chromium binary (default: Playwright's own)
 *
 * Exits 1 on any finding. Written for Dateien's round 6 (2026-11-10), whose previews looked right while dev cut the
 * findings box's lower edge under the path row and wrapped „Zurück zu / Index C“ inside its press
 * (docs/contributing/gotchas.md). Needs Playwright's Chromium (`bunx playwright-core install chromium`).
 */
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const BASE = args.find((arg) => arg.startsWith('--base='))?.slice('--base='.length) ?? 'http://localhost:3000'
const FILES = '/dev/files-page?project=real&rail=1'
const STATES = ['', '&brief=open', '&view=list', '&folders=many', '&upload=1', '&q=Bericht', '&folder=r-abgabe', '&folder=r-abgabe-long',
  '&folder=r-deep-5', '&folder=r-test', '&folder=r-grund', '&folder=r-berichte', '&folder=r-berichte&view=list',
  '&folder=r-berichte&picking=1', '&folder=r-archiv&view=list'].flatMap((state) => [`${FILES}${state}`, `${FILES}${state}&lang=en`])
const WIDTHS = [[1700, 800], [1440, 900], [1024, 768], [768, 1024], [390, 844]]

/** Runs in the page; returns the findings. */
const inPage = // Runs in the page (page.evaluate). Returns findings: cut text without its full text reachable,
// controls pushed off-screen, horizontal scroll, and sheet edges (box-shadow rings) clipped by an ancestor.
() => {
  const out = []
  const vw = window.innerWidth
  const label = (el) => {
    const id = el.getAttribute('data-testid') || el.id || ''
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} "${txt}"`
  }
  const visible = (el) => {
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false
    if (el.closest('[aria-hidden="true"], .sr-only, nextjs-portal')) return false
    if (cs.clip && cs.clip !== 'auto') return false
    return true
  }
  // The text a reader sees: a screen reader's copy of a drawn name (`.sr-only` beside its `aria-hidden` lines) is not.
  const shownText = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let text = ''
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest('.sr-only')) text += node.textContent
    return text
  }
  const reachable = (el) => {
    const text = shownText(el).trim().replace(/\s+/g, ' ')
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const t = (node.getAttribute('title') || '') + ' ' + (node.getAttribute('aria-label') || '')
      if (text && t.replace(/\s+/g, ' ').includes(text)) return true
    }
    return !text
  }
  const all = Array.from(document.querySelectorAll('body *'))
  for (const el of all) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    const hiddenX = cs.overflowX === 'hidden' || cs.overflowX === 'clip' || cs.textOverflow === 'ellipsis'
    const hiddenY = cs.overflowY === 'hidden' || cs.overflowY === 'clip'
    // Cut text: content wider (or, clamped, taller) than the box, the rest not reachable as a title or a label.
    if (el.childElementCount === 0 || cs.textOverflow === 'ellipsis' || cs.webkitLineClamp !== 'none') {
      const cutX = hiddenX && el.scrollWidth > el.clientWidth + 1
      const cutY = hiddenY && el.scrollHeight > el.clientHeight + 1 && (cs.webkitLineClamp !== 'none' || el.childElementCount === 0)
      if ((cutX || cutY) && !reachable(el)) out.push({ kind: 'cut-text', el: label(el), w: [el.scrollWidth, el.clientWidth] })
    }
    // A scroll box that scrolls sideways hides what is past its edge.
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1 && el !== document.scrollingElement) {
      out.push({ kind: 'h-scroll', el: label(el), w: [el.scrollWidth, el.clientWidth] })
    }
    // A control the reader cannot reach without scrolling the page sideways.
    if (/^(BUTTON|A|INPUT)$/.test(el.tagName)) {
      const r = el.getBoundingClientRect()
      if (r.right > vw + 1 || r.left < -1) out.push({ kind: 'off-screen', el: label(el), x: [Math.round(r.left), Math.round(r.right)] })
    }
    // A sheet's edge is a ring OUTSIDE its box: an ancestor that clips at the box's own edge cuts it.
    if (cs.boxShadow && cs.boxShadow !== 'none' && /0px 0px 0px 1px/.test(cs.boxShadow)) {
      const r = el.getBoundingClientRect()
      // Once past a box that scrolls, a cut at the top or bottom of a box around it is scrolling too.
      let scrolled = false
      for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
        const acs = getComputedStyle(a)
        const clipsX = acs.overflowX !== 'visible'
        const clipsY = acs.overflowY !== 'visible'
        if (!clipsX && !clipsY) continue
        if (scrolled && !clipsX) continue
        const ar = a.getBoundingClientRect()
        const scrollsY = acs.overflowY === 'auto' || acs.overflowY === 'scroll'
        const inView = r.bottom > ar.top && r.top < ar.bottom && r.right > ar.left && r.left < ar.right
        if (!inView) break
        const cutX = clipsX && (r.left - 1 < ar.left || r.right + 1 > ar.right)
        // Cut at the top or bottom of a box that scrolls is scrolling, not a cut; elsewhere it is.
        const cutY = clipsY && !scrollsY && !scrolled && (r.top - 1 < ar.top || r.bottom + 1 > ar.bottom)
        if (scrollsY) scrolled = true
        if (cutX || cutY) {
          out.push({ kind: 'clipped-edge', el: label(el), by: label(a).slice(0, 60) })
          break
        }
      }
    }
  }
  // A band painted over a sheet's edge (a sticky row with the page's fill right under a sheet): the topmost thing at a
  // point of the ring is neither the sheet nor one of its ancestors, and it has a fill of its own.
  for (const el of all) {
    if (!visible(el)) continue
    const cs = getComputedStyle(el)
    if (!cs.boxShadow || !/0px 0px 0px 1px/.test(cs.boxShadow)) continue
    const r = el.getBoundingClientRect()
    if (r.top < 0 || r.bottom > window.innerHeight) continue
    // A floating control (fixed) lies over the page on purpose; what is under its edge is not painted over it.
    let floating = false
    for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') floating = true
    if (floating) continue
    const points = [[(r.left + r.right) / 2, r.bottom + 0.5], [(r.left + r.right) / 2, r.top - 0.5], [r.left - 0.5, (r.top + r.bottom) / 2], [r.right + 0.5, (r.top + r.bottom) / 2]]
    for (const [x, y] of points) {
      if (x < 0 || x >= vw || y < 0 || y >= window.innerHeight) continue
      const top = document.elementFromPoint(x, y)
      if (!top || top === el || el.contains(top) || top.contains(el)) continue
      const bg = getComputedStyle(top).backgroundColor
      // Only a band that stays put over the scrolling page (sticky, fixed) paints over what scrolls under it; the ring is
      // not hit-testable, so anything else found there lies under it.
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' && /sticky|fixed/.test(getComputedStyle(top).position)) {
        out.push({ kind: 'edge-painted-over', el: label(el), by: label(top).slice(0, 60) })
        break
      }
    }
  }
  return out
}

const named = args.filter((arg) => !arg.startsWith('--'))
const routes = named.length > 0 ? named : STATES
const chrome = args.find((arg) => arg.startsWith('--chrome='))?.slice('--chrome='.length)
const browser = await chromium.launch({ executablePath: chrome })
let total = 0
for (const [width, height] of WIDTHS) {
  const phone = width < 768
  const context = await browser.newContext({ viewport: { width, height }, isMobile: phone, hasTouch: phone })
  const page = await context.newPage()
  for (const route of routes) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 180_000 })
    await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' })
    await page.waitForTimeout(500)
    const findings = await page.evaluate(inPage)
    total += findings.length
    for (const finding of findings) console.log(`${width}px ${route}  ${finding.kind}  ${finding.el}${finding.by ? `  by ${finding.by}` : ''}`)
  }
  await context.close()
}
await browser.close()
console.log(total === 0 ? 'Nothing cut off.' : `${total} finding(s).`)
process.exit(total === 0 ? 0 : 1)
