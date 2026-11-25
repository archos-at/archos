#!/usr/bin/env node
// Presses a control (`--press=<testid>`, default the temporary switch) on each route at 1280 and 390, exit 1 on any layout shift.
// The press is element.click() in the page: the browser drops shifts within 500 ms of real input (hadRecentInput).
// `--load` measures the cold load instead, at 390 and 360, from the first paint until the page has settled; `--session=<wos-session>` signs it in.
import { chromium } from 'playwright-core'

const args = process.argv.slice(2)
const option = (name, fallback) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback
const BASE = option('base', 'http://localhost:3311')
const PRESS = option('press', 'temporary-chat-toggle')
const CHROME = option('chrome', process.env.SHIFT_CHROME)
const LOAD = args.includes('--load')
const SESSION = option('session', process.env.SHIFT_SESSION)
const named = args.filter((arg) => !arg.startsWith('--'))
const ROUTES = named.length
  ? named
  : ['personal', 'project', 'existing'].map((kind) => `/dev/temporary-switch?case=${kind}`)
const WIDTHS = LOAD ? [[390, 844], [360, 780]] : [[1280, 844], [390, 844]]

const record = (fromLoad) => {
  window.__shifts = []
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
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
      if (LOAD) await page.addInitScript(record, true)
      await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 300_000 })
      if (LOAD) await page.waitForTimeout(5000)
      else await press(page)
      const shifts = await page.evaluate(() => window.__shifts)
      const score = shifts.reduce((sum, shift) => sum + shift.value, 0)
      console.log(`${shifts.length ? 'FAIL' : 'ok  '} ${route} @${width}: ${shifts.length} shifts, CLS ${score.toFixed(4)}`)
      for (const shift of shifts) for (const source of shift.sources) console.log(`       ${source}`)
      if (shifts.length) failed++
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
  await page.evaluate(record, false)
  for (let press = 0; press < 2; press++) {
    await control.evaluate((element) => element.click())
    await page.waitForTimeout(800)
  }
}
