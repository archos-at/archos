// The local stack's browser check (`local-stack.sh smoke`): anna opens
// /app/memory, adds a note and sees it after a reload; bert, in the same office,
// opens the same page and has no notes. Proves a session, the BFF, row-level
// security and the database end to end.
//
// Playwright: PLAYWRIGHT_MODULE, else `playwright` from NODE_PATH (a cloud
// session has it under /opt/node-tools), else the UI's `playwright-core`.
// Chromium: AGENT_BROWSER_EXECUTABLE_PATH when set (a cloud session's
// /opt/pw-browsers/chromium), else Playwright's own.
'use strict'

const path = require('node:path')

function loadPlaywright() {
  const candidates = [
    process.env.PLAYWRIGHT_MODULE,
    'playwright',
    '/opt/node-tools/node_modules/playwright',
    path.join(__dirname, '../../apps/workspace/node_modules/playwright-core'),
  ].filter(Boolean)
  for (const candidate of candidates) {
    try {
      return require(candidate)
    } catch {
      // next candidate
    }
  }
  throw new Error(`no Playwright found (tried ${candidates.join(', ')}); set PLAYWRIGHT_MODULE`)
}

const base = process.env.LOCAL_STACK_UI_ORIGIN
const cookies = { anna: process.env.LOCAL_STACK_COOKIE_ANNA, bert: process.env.LOCAL_STACK_COOKIE_BERT }
if (!base || !cookies.anna || !cookies.bert) {
  throw new Error('run through `local-stack.sh smoke`: LOCAL_STACK_UI_ORIGIN and the two cookies are missing')
}

async function openAs(browser, who) {
  const context = await browser.newContext({ locale: 'de-AT', viewport: { width: 1440, height: 900 } })
  await context.addCookies([
    { name: 'wos-session', value: cookies[who], domain: new URL(base).hostname, path: '/', httpOnly: true, sameSite: 'Lax' },
  ])
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log(`[${who}] page error: ${String(error).slice(0, 200)}`))
  // The page keeps reconnecting to /api/stream, so `networkidle` never comes: wait for the DOM, then the control.
  await page.goto(`${base}/app/memory`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
  return { context, page }
}

async function notes(page) {
  return page.evaluate(async () => {
    const response = await fetch('/api/user/memory?limit=200')
    const body = await response.json().catch(() => null)
    return { status: response.status, body }
  })
}

const count = (result) => {
  const body = result.body
  const items = Array.isArray(body) ? body : (body?.items ?? body?.notes ?? body?.data ?? [])
  return Array.isArray(items) ? items.length : NaN
}

async function main() {
  const { chromium } = loadPlaywright()
  const browser = await chromium.launch({ executablePath: process.env.AGENT_BROWSER_EXECUTABLE_PATH || undefined })
  const text = `Lokale Probe ${new Date().toISOString()}: Maße bitte in Zentimetern.`
  try {
    const anna = await openAs(browser, 'anna')
    const add = anna.page.getByRole('button', { name: /^(Notiz hinzufügen|Add note)$/ })
    await add.waitFor({ timeout: 180_000 })
    console.log(`anna: /app/memory rendered, ${count(await notes(anna.page))} note(s) before`)
    await add.click()
    await anna.page.locator('main').getByRole('textbox').first().fill(text)
    await anna.page.getByRole('button', { name: /^(Hinzufügen|Add)$/ }).click()
    await anna.page.getByText(text).waitFor({ timeout: 30_000 })
    await anna.page.reload({ waitUntil: 'domcontentloaded' })
    await anna.page.getByText(text).waitFor({ timeout: 60_000 })
    const annaNotes = await notes(anna.page)
    console.log(`anna: note added and still there after a reload; GET /api/user/memory ${annaNotes.status}, ${count(annaNotes)} note(s)`)
    await anna.context.close()

    const bert = await openAs(browser, 'bert')
    await bert.page.getByRole('button', { name: /^(Notiz hinzufügen|Add note)$/ }).waitFor({ timeout: 180_000 })
    const bertNotes = await notes(bert.page)
    const seesAnnas = (await bert.page.getByText(text).count()) > 0
    console.log(`bert: GET /api/user/memory ${bertNotes.status}, ${count(bertNotes)} note(s); anna's note on his page: ${seesAnnas}`)
    await bert.context.close()

    if (annaNotes.status !== 200 || bertNotes.status !== 200 || count(bertNotes) !== 0 || seesAnnas) {
      throw new Error('smoke failed: see the lines above')
    }
    console.log('smoke passed')
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(String(error))
  process.exit(1)
})
