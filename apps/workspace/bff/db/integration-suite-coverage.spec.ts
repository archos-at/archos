// @disk-inputs: ../../scripts/rls-test-db-suites.txt, ../../taskfiles/**, app/**, bff/**, i18n/**, shared/**, types/**, ui/**, utils/**
/**
 * @vitest-environment node
 *
 * Every Postgres integration spec runs somewhere. A spec that reads
 * `TEST_DATABASE_URL` skips itself everywhere except under `task db:test:rls`,
 * which runs the suites `scripts/rls-test-db-suites.txt` names, step by step.
 * A spec missing from that list is green in every gate and proves nothing.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { nodesOf, parseSource, ts } from '@/test-utils/source-ast'
import { SOURCE_DIRS } from '@/test-utils/source-tree'

const UI = process.cwd()
const REPO = join(UI, '..', '..')
const SUITES = join(REPO, 'scripts', 'rls-test-db-suites.txt')
const TASKFILES = join(REPO, 'taskfiles')
const DATABASE_URL = 'TEST_DATABASE_URL'
const NOT_YET_RUN = 'not-yet-run'
const SPEC = /\.spec\.[cm]?[jt]sx?$/

type Suite = { step: string; path: string }

function suites(): Suite[] {
  return readFileSync(SUITES, 'utf8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const [step, path, ...rest] = line.trim().split(/\s+/)
      expect(rest, `one step and one path per line: ${line}`).toEqual([])
      return { step, path }
    })
}

function strings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(strings)
  if (value && typeof value === 'object') return Object.values(value).flatMap(strings)
  return []
}

function specsRunByATask(): Set<string> {
  const commands = readdirSync(TASKFILES)
    .filter((name) => name.endsWith('.yml'))
    .flatMap((name) => strings(parse(readFileSync(join(TASKFILES, name), 'utf8'))))
  return new Set(
    commands.flatMap((command) => {
      const words = command.split(/\s+/)
      const only = words.indexOf('--only')
      return only < 0 ? [] : words.slice(only + 1)
    }),
  )
}

function named(name: ts.Expression | ts.MemberName): boolean {
  return (ts.isStringLiteralLike(name) || ts.isIdentifier(name)) && name.text === DATABASE_URL
}

function readsDatabaseUrl(path: string): boolean {
  const source = parseSource(path, UI)
  return (
    nodesOf(source, ts.isPropertyAccessExpression).some((access) => named(access.name)) ||
    nodesOf(source, ts.isElementAccessExpression).some((access) => named(access.argumentExpression))
  )
}

function specsNeedingPostgres(): string[] {
  return SOURCE_DIRS.flatMap((dir) =>
    readdirSync(join(UI, dir), { recursive: true, encoding: 'utf8' })
      .filter((entry) => SPEC.test(entry) && !entry.split(/[\\/]/).includes('node_modules'))
      .map((entry) => `${dir}/${entry.replace(/\\/g, '/')}`),
  ).filter(readsDatabaseUrl)
}

describe('the Postgres integration suite', () => {
  const listed = suites()
  const run = new Set(listed.filter((suite) => suite.step !== NOT_YET_RUN).map((suite) => suite.path))
  const notYetRun = listed.filter((suite) => suite.step === NOT_YET_RUN).map((suite) => suite.path)
  const byATask = specsRunByATask()
  const needingPostgres = specsNeedingPostgres()

  it('runs every spec that needs Postgres', () => {
    const missing = needingPostgres.filter((path) => !run.has(path) && !notYetRun.includes(path) && !byATask.has(path))
    expect(missing, 'Add these to scripts/rls-test-db-suites.txt (or a task running rls-test-db with --only), or nothing ever runs them').toEqual([])
  })

  it('keeps the exemptions honest', () => {
    const stale = notYetRun.filter((path) => run.has(path) || !needingPostgres.includes(path))
    expect(stale, `These run now (or are gone): drop their ${NOT_YET_RUN} lines`).toEqual([])
  })
})
