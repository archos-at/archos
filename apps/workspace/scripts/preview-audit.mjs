import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { chromium } from 'playwright-core'

const here = dirname(fileURLToPath(import.meta.url))
export const appRoot = join(here, '..')
const require = createRequire(import.meta.url)
const DEV_DIR = join(appRoot, 'app', 'dev')

const DYNAMIC_SEGMENT_SAMPLE = 'overview'

export function previewRoutes() {
  const routes = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(join(dir, entry.name))
      else if (entry.name === 'page.tsx') {
        const segments = relative(join(appRoot, 'app'), dir)
          .split(sep)
          .filter((segment) => !/^\[\[\.\.\..+\]\]$/.test(segment) && !/^\(.+\)$/.test(segment))
          .map((segment) => (/^\[.+\]$/.test(segment) ? DYNAMIC_SEGMENT_SAMPLE : segment))
        routes.push(`/${segments.join('/')}`)
      }
    }
  }
  walk(DEV_DIR)
  return [...new Set(routes)].sort()
}

export function parseArgs(argv) {
  const named = argv.filter((a) => a.startsWith('/'))
  const shardAt = argv.indexOf('--shard')
  const shard = shardAt >= 0 ? argv[shardAt + 1] : undefined
  const match = shard ? /^(\d+)\/(\d+)$/.exec(shard) : null
  if (shard && (!match || Number(match[1]) < 1 || Number(match[1]) > Number(match[2]))) {
    throw new Error(`--shard takes i/n with 1 <= i <= n, got ${shard}`)
  }
  return {
    named,
    shard: match ? { index: Number(match[1]), total: Number(match[2]) } : undefined,
    writeBaseline: argv.includes('--write-baseline'),
  }
}

export const inShard = (routes, shard) => (shard ? routes.filter((_, i) => i % shard.total === shard.index - 1) : routes)

const freePort = () =>
  new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.on('error', reject)
    server.listen(0, () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })

const run = (command, args, env) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: appRoot, env, stdio: 'inherit' })
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${args.join(' ')} exited ${code}`))))
  })

export async function startDevServer() {
  const port = await freePort()
  const origin = `http://localhost:${port}`
  const placeholder = {
    WORKOS_CLIENT_ID: 'client_a11y_audit',
    WORKOS_API_KEY: 'a11y-audit-placeholder',
    WORKOS_REDIRECT_URI: `${origin}/api/auth/callback`,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: `${origin}/api/auth/callback`,
    WORKOS_COOKIE_PASSWORD: 'a11y-audit-placeholder-cookie-password-32+',
  }
  const env = { ...placeholder, ...process.env, NEXT_TELEMETRY_DISABLED: '1' }
  for (const step of ['scripts/copy-pdfjs-assets.mjs', 'scripts/copy-excalidraw-assets.mjs']) {
    await run(process.execPath, [step], env)
  }
  const next = require.resolve('next/dist/bin/next')
  const child = spawn(process.execPath, [next, 'dev', '--turbopack', '-p', String(port)], {
    cwd: appRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  const ready = new Promise((resolve, reject) => {
    const onData = (chunk) => {
      log += chunk
      if (/Ready in/.test(log)) resolve()
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.on('exit', (code) => reject(new Error(`next dev exited (${code}) before it was ready:\n${log.slice(-2000)}`)))
  })
  await ready
  return { origin, stop: () => child.kill('SIGTERM') }
}

export async function auditRoutes({ routes, concurrency, executablePath, auditRoute }) {
  const launch = () => chromium.launch({ executablePath: executablePath || undefined })
  let browser
  let relaunching
  const liveBrowser = async () => {
    if (browser?.isConnected()) return browser
    relaunching ??= launch().then((fresh) => {
      browser = fresh
      relaunching = undefined
      return fresh
    })
    return relaunching
  }
  const queue = [...routes]
  const started = Date.now()
  try {
    browser = await launch()
    await Promise.all(
      Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        for (let route = queue.shift(); route; route = queue.shift()) {
          await auditRoute(await liveBrowser(), route)
          console.log(`  ${route} (${Math.round((Date.now() - started) / 1000)}s)`)
        }
      }),
    )
  } finally {
    await browser?.close().catch(() => {})
  }
}

export function judgeAgainstBaseline({ baseline, found, routes, discovered, args, title, stalePending = [], pendingFile }) {
  const name = relative(join(appRoot, '..', '..'), baseline)
  const audited = new Set(routes)
  const inScope = (key) => audited.has(key.split(' ')[0])
  if (args.writeBaseline) {
    const kept = existsSync(baseline) ? JSON.parse(readFileSync(baseline, 'utf8')).filter((key) => !inScope(key)) : []
    writeFileSync(baseline, `${JSON.stringify([...kept, ...found.keys()].sort(), null, 2)}\n`)
    console.log(`baseline: ${kept.length + found.size} entries`)
    return 0
  }
  const known = new Set(existsSync(baseline) ? JSON.parse(readFileSync(baseline, 'utf8')) : [])
  const fresh = [...found.keys()].filter((key) => !known.has(key))
  const reportsOrphans = !args.named.length && (!args.shard || args.shard.index === 1)
  const orphan = (key) => reportsOrphans && !discovered.includes(key.split(' ')[0])
  const gone = [...known].filter((key) => (inScope(key) && !found.has(key)) || orphan(key))
  const annotate = (message) => process.env.GITHUB_ACTIONS === 'true' && console.log(`::error title=${title}::${message.replace(/\n/g, '%0A')}`)
  for (const key of fresh) {
    const v = found.get(key)
    console.log(`NEW   ${key}  x${v.count}  ${v.help}\n      ${v.sample}`)
    annotate(`NEW ${key} x${v.count} ${v.help}: ${v.sample}`)
  }
  for (const key of gone) {
    console.log(`FIXED ${key} (remove it from ${name})`)
    annotate(`FIXED ${key} (remove it from ${name})`)
  }
  for (const route of stalePending) {
    console.log(`GONE  ${route} (remove it from ${pendingFile})`)
    annotate(`GONE ${route} (remove it from ${pendingFile})`)
  }
  console.log(`${found.size} finding groups, ${fresh.length} new, ${gone.length} fixed`)
  return fresh.length || gone.length || stalePending.length ? 1 : 0
}
