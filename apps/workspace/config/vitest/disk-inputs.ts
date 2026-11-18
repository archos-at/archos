/**
 * What a spec reads from disk, checked against what it declares.
 *
 * A spec that reads the tree (a route walker, a migration check, a contract
 * against a Python file) has inputs no import graph sees, so the pull-request
 * selection (`ci/pr_selection.py`, `decide_ui`) used to run all of them on every
 * UI selection. Each now declares its inputs in a header line:
 *
 *   // @disk-inputs: app/api/**\/route.ts, ../../tests/fixtures/exposure.json
 *
 * Globs are relative to `apps/workspace`, the way `process.cwd()` is in a spec.
 * The selection runs a declaring spec only when a changed path matches one, and
 * this file keeps the declaration honest: it records every path the spec reads
 * while it runs and fails the file when one falls outside the declaration.
 *
 * `DISK_INPUTS=record` writes what each spec read to `.disk-inputs/` instead of
 * checking, which is how a declaration is first written
 * (`node scripts/declare-disk-inputs.mjs`).
 */
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import path from 'node:path'
import { afterAll, expect } from 'vitest'

const UI_ROOT = path.resolve(__dirname, '..', '..')
const REPO_ROOT = path.resolve(UI_ROOT, '..', '..')

export const DECLARATION = /^\s*\/\/\s*@disk-inputs:\s*(.+)$/m

export const SPAWNS = /['"](?:node:)?child_process['"]/

type State = { reads: Set<string>; installed: boolean }
const KEY = Symbol.for('vitest.disk-inputs')
const state: State = ((globalThis as Record<symbol, State>)[KEY] ??= { reads: new Set(), installed: false })

function isFileUrl(target: unknown): target is { pathname: string } {
  if (typeof target !== 'object' || target === null) return false
  const url = target as { protocol?: unknown; pathname?: unknown }
  return url.protocol === 'file:' && typeof url.pathname === 'string'
}

export function asInput(target: unknown): string | null {
  let file: string
  if (typeof target === 'string') file = target
  else if (isFileUrl(target)) file = target.pathname
  else return null
  const absolute = path.resolve(file)
  const relative = path.relative(REPO_ROOT, absolute)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null
  if (/(^|\/)(node_modules|\.next|coverage|\.git|\.disk-inputs)(\/|$)/.test(relative)) return null
  return path.relative(UI_ROOT, absolute).split(path.sep).join('/')
}

function wrap<T extends object>(target: T, names: string[]): void {
  const record = target as Record<string, unknown>
  for (const name of names) {
    const original = record[name]
    if (typeof original !== 'function') continue
    record[name] = function (this: unknown, ...args: unknown[]) {
      const input = asInput(args[0])
      if (input) state.reads.add(input)
      return (original as (...a: unknown[]) => unknown).apply(this, args)
    }
  }
}

if (!state.installed) {
  state.installed = true
  wrap(fs, ['readFileSync', 'readdirSync', 'existsSync', 'statSync', 'lstatSync', 'opendirSync', 'globSync'])
  wrap(fs.promises, ['readFile', 'readdir', 'stat', 'glob'])
  syncBuiltinESMExports()
}
state.reads.clear()

function segmentMatches(glob: string, name: string): boolean {
  const parts = glob.split('*')
  if (parts.length === 1) return glob === name
  const first = parts[0]!
  const last = parts.at(-1)!
  if (!name.startsWith(first) || !name.endsWith(last) || name.length < first.length + last.length) return false
  let at = first.length
  for (const part of parts.slice(1, -1)) {
    const found = name.indexOf(part, at)
    if (found === -1 || found + part.length > name.length - last.length) return false
    at = found + part.length
  }
  return true
}

export function globMatcher(glob: string): (path: string) => boolean {
  const globs = glob.split('/')
  const match = (g: number, names: string[], n: number): boolean => {
    if (g === globs.length) return n === names.length
    if (globs[g] === '**') {
      for (let skip = n; skip <= names.length; skip++) if (match(g + 1, names, skip)) return true
      return false
    }
    return n < names.length && segmentMatches(globs[g]!, names[n]!) && match(g + 1, names, n + 1)
  }
  return (path) => match(0, path.split('/'), 0)
}

export function uncovered(reads: Iterable<string>, globs: string[]): string[] {
  const matchers = globs.map(globMatcher)
  const covers = (read: string) =>
    matchers.some((matches) => matches(read)) || globs.some((glob) => glob.startsWith(`${read}/`))
  return [...reads].filter((read) => !covers(read)).sort()
}

const spec = expect.getState().testPath
if (spec) {
  const source = fs.readFileSync(spec, 'utf8')
  const declared = DECLARATION.exec(source)?.[1]
  const own = asInput(spec)
  afterAll(() => {
    const reads = [...state.reads].filter(
      (read) => read !== own && !read.startsWith('config/vitest/') && !/(^|\/)__snapshots__(\/|$)/.test(read),
    )
    if (process.env.DISK_INPUTS === 'record') {
      const out = path.join(UI_ROOT, '.disk-inputs')
      fs.mkdirSync(out, { recursive: true })
      fs.writeFileSync(path.join(out, `${own!.replaceAll('/', '__')}.json`), JSON.stringify({ spec: own, reads }))
      return
    }
    if (!declared) return
    if (SPAWNS.test(source)) {
      throw new Error(
        `${own} starts a process, whose reads config/vitest/disk-inputs.ts cannot see, so it cannot ` +
          `declare @disk-inputs: delete the line, and it runs on every selection`,
      )
    }
    const globs = declared.split(',').map((glob) => glob.trim()).filter(Boolean)
    const missing = uncovered(reads, globs)
    if (missing.length) {
      throw new Error(
        `${own} read ${missing.length} path(s) its @disk-inputs line does not declare, so a pull request ` +
          `changing them would not run it (config/vitest/disk-inputs.ts):\n  ${missing.join('\n  ')}`,
      )
    }
  })
}
