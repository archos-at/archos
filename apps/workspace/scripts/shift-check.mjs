#!/usr/bin/env node
// Presses a control (`--press=<testid>`) at 1280 and 390, exit 1 on any shift; element.click() in the page, since real input hides shifts.
// `--load`: the cold load at 390 and 360 (`--session=<wos-session>` signs in). `--stream`: a /dev stream page played to done at 1280 and 390,
// the caret left out, counting boxes inside `--scope=<css>` against `--budget=<cls>`.
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const BASE = option('base', 'http://localhost:3311')
const PRESS = option('press', 'temporary-chat-toggle')
const CHROME = option('chrome', process.env.SHIFT_CHROME)
const LOAD = args.includes('--load')
const STREAM = args.includes('--stream')
const SCOPE = option('scope', 'body')
const BUDGET = Number(option('budget', '0'))
const SESSION = option('session', process.env.SHIFT_SESSION)
const named = args.filter((arg) => !arg.startsWith('--'))
const ROUTES = named.length
  ? named
  : ['personal', 'project', 'existing'].map((kind) => `/dev/temporary-switch?case=${kind}`)
const WIDTHS = LOAD ? [[390, 844], [360, 780]] : [[1280, 844], [390, 844]]

async function played(page) {
  await page.waitForFunction(() => window.__replay?.done ?? window.__streamSocket?.done, null, { timeout: 300_000 })
  await page.waitForTimeout(1500)
}

const record = ({ fromLoad, scope }) => {
  window.__shifts = []
  const nodeOf = (source) => (source.node?.nodeType === 1 ? source.node : source.node?.parentElement)
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const counted = entry.sources.filter((source) => {
        const node = nodeOf(source)
        return node?.closest?.(scope) && !node.closest('[data-caret-after], [data-testid="streaming-caret"]')
      })
      if (entry.sources.length > 0 && counted.length === 0) continue
      window.__shifts.push({
        value: entry.value,
        sources: entry.sources.map((source) => {
          const node = source.node?.nodeType === 1 ? source.node : source.node?.parentElement
          const id = node?.getAttribute?.('data-testid')
          const rect = (r) => [r.x, r.y, r.width, r.height].map(Math.round).join(',')
          return `${node?.tagName?.toLowerCase() ?? '?'}${id ? `[${id}]` : ''} ${rect(source.previousRect)} → ${rect(source.currentRect)}`
        }),
      })
    }
  }).observe({ type: 'layout-shift', buffered: fromLoad })
}

const browser = await chromium.launch(CHROME ? { executablePath: CHROME } : {})
let failed = 0
try {
  for (const route of ROUTES) {
    for (const [width, height] of WIDTHS) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: LOAD, hasTouch: LOAD })
      if (SESSION) await page.context().addCookies([{ name: 'wos-session', value: SESSION, url: BASE }])
      if (LOAD || STREAM) await page.addInitScript(record, { fromLoad: true, scope: SCOPE })
      await page.goto(`${BASE}${route}`, { waitUntil: STREAM ? 'domcontentloaded' : 'networkidle', timeout: 300_000 })
      if (LOAD) await page.waitForTimeout(5000)
      else if (STREAM) await played(page)
      else await press(page)
      const shifts = await page.evaluate(() => window.__shifts)
      const score = shifts.reduce((sum, shift) => sum + shift.value, 0)
      const over = STREAM ? score > BUDGET : shifts.length > 0
      console.log(`${over ? 'FAIL' : 'ok  '} ${route} @${width}: ${shifts.length} shifts, CLS ${score.toFixed(4)}`)
      for (const shift of shifts) for (const source of shift.sources) console.log(`       ${source}`)
      if (over) failed++
      await page.close()
    }
  }
} finally {
  await browser.close()
}
process.exit(failed ? 1 : 0)

async function press(page) {
  const control = page.getByTestId(PRESS)
  await control.waitFor({ timeout: 300_000 })
  await page.waitForTimeout(1000)
  await page.evaluate(record, { fromLoad: false, scope: SCOPE })
  for (let press = 0; press < 2; press++) {
    await control.evaluate((element) => element.click())
    await page.waitForTimeout(800)
  }
}
