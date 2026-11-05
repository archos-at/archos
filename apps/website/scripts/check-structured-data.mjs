#!/usr/bin/env node
/**
 * Every JSON-LD block in the built pages parses, and every node carries the fields its
 * schema.org type needs (the fields Google's rich-result docs require, plus our own rules).
 *
 *   bun run build && bun run check:structured-data
 *
 * Reads dist/client/**\/*.html, and the blog's pages, which are rendered on request
 * (ADR-0155), from the production server (`runtime/server.mjs`, without a CMS: the
 * fixtures), every page `/sitemap-blog.xml` lists. Also holds the site's own rules: every indexed inner page
 * has a BreadcrumbList that ends at itself, a page with an FAQ has an FAQPage with the same
 * number of questions, the home page has a SoftwareApplication without price or rating.
 */
import { spawn } from 'node:child_process'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { createServer } from 'node:net'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const CLIENT = fileURLToPath(new URL('../dist/client/', import.meta.url))
const BLOG = fileURLToPath(new URL('../src/content/blog/', import.meta.url))

/** Every published post's address, read from the content: each must carry a BlogPosting. */
function postPaths() {
  const paths = new Set()
  for (const [locale, base] of [['de', '/blog/'], ['en', '/en/blog/']]) {
    for (const file of readdirSync(join(BLOG, locale)).filter((f) => f.endsWith('.mdx'))) {
      if (/^draft:\s*true$/m.test(readFileSync(join(BLOG, locale, file), 'utf8'))) continue
      paths.add(`${base}${file.replace(/\.mdx$/, '')}/`)
    }
  }
  return paths
}
const POSTS = postPaths()

/** Required fields per type. A value that is an empty string or array counts as missing. */
const REQUIRED = {
  Organization: ['@id', 'name', 'url', 'logo'],
  WebSite: ['@id', 'name', 'url', 'publisher'],
  SoftwareApplication: ['name', 'description', 'applicationCategory', 'operatingSystem', 'publisher'],
  BreadcrumbList: ['itemListElement'],
  ListItem: ['position', 'name', 'item'],
  FAQPage: ['mainEntity'],
  Question: ['name', 'acceptedAnswer'],
  Answer: ['text'],
  BlogPosting: ['headline', 'datePublished', 'author', 'publisher', 'image', 'mainEntityOfPage'],
  PostalAddress: ['streetAddress', 'postalCode', 'addressLocality', 'addressCountry'],
}

/** Fields that would claim what has no evidence (Belegpflicht). */
const FORBIDDEN = { SoftwareApplication: ['offers', 'aggregateRating', 'review'] }

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return htmlFiles(path)
    return name.endsWith('.html') ? [path] : []
  })
}

/** Every object with an `@type` in a parsed block, nested ones included. */
function typedNodes(value, out = []) {
  if (Array.isArray(value)) value.forEach((v) => typedNodes(v, out))
  else if (value && typeof value === 'object') {
    if (value['@type']) out.push(value)
    Object.values(value).forEach((v) => typedNodes(v, out))
  }
  return out
}

const missing = (node, field) => {
  const v = node[field]
  return v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
}

const problems = []
let blocks = 0
let nodes = 0

/** Every rule above, on one page's HTML. */
function checkPage(page, html) {
  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])
  if (scripts.length === 0) {
    problems.push(`${page}: no JSON-LD`)
    return
  }
  const all = []
  for (const text of scripts) {
    blocks += 1
    let data
    try {
      data = JSON.parse(text)
    } catch (error) {
      problems.push(`${page}: JSON-LD does not parse (${error.message})`)
      continue
    }
    if (data['@context'] !== 'https://schema.org') problems.push(`${page}: @context is not https://schema.org`)
    all.push(...typedNodes(data))
  }
  nodes += all.length
  for (const node of all) {
    for (const field of REQUIRED[node['@type']] ?? []) if (missing(node, field)) problems.push(`${page}: ${node['@type']} without ${field}`)
    for (const field of FORBIDDEN[node['@type']] ?? []) if (field in node) problems.push(`${page}: ${node['@type']} claims ${field}`)
  }
  const types = all.map((n) => n['@type'])
  const noindex = /<meta name="robots" content="noindex"/.test(html)
  const isHome = page === '/' || page === '/en/'
  if (isHome && !types.includes('SoftwareApplication')) problems.push(`${page}: home without SoftwareApplication`)
  if (!isHome && !noindex) {
    const crumbs = all.find((n) => n['@type'] === 'BreadcrumbList')
    const last = crumbs?.itemListElement?.at(-1)?.item
    if (!crumbs) problems.push(`${page}: inner page without BreadcrumbList`)
    else if (!last || new URL(last).pathname !== page) problems.push(`${page}: breadcrumbs end at ${last}, not at the page`)
  }
  // The FAQ component's questions: the <details> inside the block it marks `data-faq`. Not the
  // `ui-faq` class: the changelog folds its weeks with the same styling and is no FAQ.
  const faqBlock = /<div [^>]*\bdata-faq\b[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  const questions = (faqBlock.match(/<details/g) ?? []).length
  const faq = all.find((n) => n['@type'] === 'FAQPage')
  if (questions > 0) {
    if (!faq) problems.push(`${page}: renders an FAQ without FAQPage`)
    else if (faq.mainEntity.length !== questions) problems.push(`${page}: FAQPage has ${faq.mainEntity.length} questions, the page ${questions}`)
  }
  // A post, ticked off the content's list; anything left on it was never built.
  if (POSTS.delete(page) && !types.includes('BlogPosting')) problems.push(`${page}: blog post without BlogPosting`)
}

for (const file of htmlFiles(CLIENT)) checkPage(`/${relative(CLIENT, file)}`.replace(/index\.html$/, ''), readFileSync(file, 'utf8'))

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
  })
}

/** The blog's pages from the production server, without a CMS. */
async function checkBlog() {
  const port = await freePort()
  const base = `http://127.0.0.1:${port}`
  const env = { ...process.env, HOST: '127.0.0.1', PORT: String(port), CMS_URL: '', CMS_TOKEN: '', PUBLIC_POSTHOG_HOST: '', PUBLIC_POSTHOG_PROJECT_TOKEN: '' }
  const server = spawn(process.execPath, [fileURLToPath(new URL('../runtime/server.mjs', import.meta.url))], { env, stdio: 'ignore' })
  try {
    let sitemap
    for (let i = 0; i < 50 && !sitemap; i += 1) {
      sitemap = await fetch(`${base}/sitemap-blog.xml`).then((r) => (r.ok ? r.text() : undefined), () => undefined)
      if (!sitemap) await new Promise((r) => setTimeout(r, 200))
    }
    if (!sitemap) throw new Error('the server did not answer /sitemap-blog.xml')
    for (const [, loc] of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
      const page = new URL(loc).pathname
      checkPage(page, await (await fetch(`${base}${page}`)).text())
    }
  } finally {
    server.kill()
  }
}
await checkBlog()

for (const page of POSTS) problems.push(`${page}: a published post with no built page`)

if (problems.length > 0) {
  console.error(`structured data: ${problems.length} problem(s)`)
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(`structured data holds: ${blocks} JSON-LD blocks, ${nodes} typed nodes, every required field present`)
