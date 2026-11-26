#!/usr/bin/env node
// Copies src/ into each app that sends mail, since no app's Docker build sees packages/.
// `node packages/mail/sync.mjs` writes; `--check` exits 1 on a stale, missing or extra copy.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const MAIL = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(MAIL, '../..')
export const TARGETS = ['apps/website/src/lib/mail']
const HEADER = '// Generated from packages/mail/src by packages/mail/sync.mjs. Edit there, then run it.\n'

const sources = new Map(
  readdirSync(join(MAIL, 'src'))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .map((name) => [name, HEADER + readFileSync(join(MAIL, 'src', name), 'utf8')]),
)

const problems = []
const checking = process.argv.includes('--check')
for (const target of TARGETS) {
  const dir = join(REPO, target)
  for (const [name, content] of sources) {
    const path = join(dir, name)
    if (existsSync(path) && readFileSync(path, 'utf8') === content) continue
    if (checking) problems.push(`${target}/${name}`)
    else {
      mkdirSync(dir, { recursive: true })
      writeFileSync(path, content)
    }
  }
  for (const name of existsSync(dir) ? readdirSync(dir) : []) {
    if (sources.has(name)) continue
    if (checking) problems.push(`${target}/${name} (not in packages/mail/src)`)
    else rmSync(join(dir, name))
  }
}
if (problems.length > 0) {
  console.error('mail copies are stale, missing or unexpected (run: node packages/mail/sync.mjs):')
  for (const p of problems) console.error(`  ${p}`)
  process.exit(1)
}
console.log(checking ? `mail copies in sync (${TARGETS.join(', ')})` : `mail copied to ${TARGETS.join(', ')}`)
