// @disk-inputs: app/**

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript-api'
import { describe, expect, it } from 'vitest'
import { PRE_EXISTING_DB_IMPORTERS } from '../../eslint-rules/route-db-access-allowlist.mjs'

const APP_DIR = join(process.cwd(), 'app')

const PRE_EXISTING_ROUTE_HANDLERS = PRE_EXISTING_DB_IMPORTERS

function appFiles(dir = APP_DIR, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) appFiles(full, found)
    else if (/\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)) found.push(full)
  }
  return found
}

const relative = (file: string) =>
  file.slice(process.cwd().length + 1).replaceAll('\\', '/')

function valueImportSpecifiers(source: string, filename: string): Set<string> {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Set<string>()

  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement)) continue
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue

    const clause = statement.importClause
    if (!clause) {
      found.add(statement.moduleSpecifier.text)
      continue
    }
    if (clause.isTypeOnly) continue

    let importsValue = clause.name !== undefined
    const bindings = clause.namedBindings
    if (bindings) {
      if (ts.isNamespaceImport(bindings)) {
        importsValue = true
      } else {
        importsValue ||= bindings.elements.some((element) => !element.isTypeOnly)
      }
    }
    if (importsValue) found.add(statement.moduleSpecifier.text)
  }
  return found
}

const DB_MODULE_PREFIX = '@/lib/db'
const NOT_DATABASE_ACCESS = new Set(['@/lib/db/tenant-context'])

const reachesDatabase = (specifiers: Set<string>) =>
  [...specifiers].some(
    (specifier) =>
      !NOT_DATABASE_ACCESS.has(specifier) &&
      (specifier === DB_MODULE_PREFIX || specifier.startsWith(`${DB_MODULE_PREFIX}/`)),
  )

describe('transport code does not query the database directly', () => {
  const offenders = appFiles()
    .filter((file) => reachesDatabase(valueImportSpecifiers(readFileSync(file, 'utf8'), file)))
    .map(relative)
    .sort()

  const isRouteHandler = (file: string) => file.endsWith('/route.ts')

  it('no server component or server action opens the database', () => {
    expect(
      offenders.filter((file) => !isRouteHandler(file)),
      'A page, layout or server action is querying directly. That is the shape that ' +
        'bypassed ADR-0038 FGA filtering and lost the tenant context: move the query ' +
        'into lib/<domain>/service.ts or lib/<domain>/repository.ts and call that.',
    ).toEqual([])
  })

  describe('the guard itself', () => {
    const detects = (source: string) => reachesDatabase(valueImportSpecifiers(source, 'probe.tsx'))

    it.each([
      ['plain named value', "import { getDb } from '@/lib/db'"],
      ['default plus named', "import db, { projects } from '@/lib/db'"],
      ['default only', "import db from '@/lib/db'"],
      ['namespace', "import * as db from '@/lib/db'"],
      ['side-effect (still evaluates the module)', "import '@/lib/db'"],
      ['table values from schema', "import { projects } from '@/lib/db/schema'"],
      ['a schema subpath', "import { projects } from '@/lib/db/schema/tables'"],
      ['mixed type and value specifiers', "import { type Project, projects } from '@/lib/db/schema'"],
      ['multi-line', "import db,\n  { projects } from '@/lib/db'"],
    ])('catches %s', (_label, source) => {
      expect(detects(source)).toBe(true)
    })

    it.each([
      ['a type-only clause', "import type { Project } from '@/lib/db/schema'"],
      ['an inline type specifier', "import { type Project } from '@/lib/db/schema'"],
      ['several inline type specifiers', "import { type Project, type Document } from '@/lib/db/schema'"],
      ['an unrelated module', "import { cn } from '@/lib/utils'"],
      ['a module that merely starts with the same text', "import { x } from '@/lib/dbutils'"],
      ['the tenant-scoping helper, which callers SHOULD use', "import { withTenant } from '@/lib/db/tenant-context'"],
    ])('does not flag %s', (_label, source) => {
      expect(detects(source)).toBe(false)
    })
  })

  it('no NEW route handler opens the database', () => {
    expect(
      offenders.filter(isRouteHandler),
      'Route handlers are thin transport (ADR-0017). If you are adding one, put the ' +
        'query in a service instead of extending the pre-existing list.',
    ).toEqual(PRE_EXISTING_ROUTE_HANDLERS)
  })
})
