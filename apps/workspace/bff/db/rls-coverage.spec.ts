// @disk-inputs: ../../deploy/compose/init-db.sql, ../../deploy/postgres/rename-legacy-names.sh, ../../scripts/rls-test-db.sh, migrations/*.sql

import { readdirSync } from 'node:fs'
import { Table, getTableName, is } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import {
  functionCalls,
  parseSql,
  readSql,
  tokenizeSql,
  type SqlStatement,
  type SqlToken,
} from '@/test-utils/sql-statements'
import * as schema from './schema'

const TENANT_HELPERS = ['secure_table', 'grid_secure_table']
const PLATFORM_HELPERS = ['secure_platform_table', 'grid_secure_platform_table']

interface Migration {
  file: string
  statements: SqlStatement[]
}

function withQuotedStatements(statements: SqlStatement[]): SqlStatement[] {
  return statements.flatMap((statement) => {
    const quoted = statement.tokens.flatMap((token) => (token.kind === 'string' ? parseSql(token.text) : []))
    return [statement, ...withQuotedStatements(quoted)]
  })
}

const MIGRATIONS: Migration[] = readdirSync('migrations')
  .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
  .sort()
  .map((file) => ({ file, statements: withQuotedStatements(readSql(`migrations/${file}`)) }))

interface HelperCall {
  table: string
  predicate: string | undefined
}

function word(token: SqlToken | undefined, text: string): boolean {
  return token?.kind === 'word' && token.text.toLowerCase() === text
}

function helperCalls(statements: SqlStatement[], helpers: string[]): HelperCall[] {
  return helpers.flatMap((helper) =>
    functionCalls(statements, helper).flatMap(([table, ...rest]) => {
      if (table?.kind !== 'string') return []
      const parts = rest.filter((token) => token.kind === 'string')
      return [{ table: table.text, predicate: parts.length > 0 ? parts.map((part) => part.text).join('') : undefined }]
    })
  )
}

function securedTables(helpers: string[]): string[] {
  const names = MIGRATIONS.flatMap(({ statements }) => helperCalls(statements, helpers).map(({ table }) => table))
  return [...new Set(names)].sort()
}

function predicates(): Map<string, string> {
  const found = new Map<string, string>()
  for (const { statements } of MIGRATIONS) {
    for (const { table, predicate } of helperCalls(statements, TENANT_HELPERS)) {
      if (predicate !== undefined) found.set(table, predicate)
    }
  }
  return found
}

function declaredTables(): string[] {
  return (Object.values(schema) as unknown[])
    .filter((value): value is Table => is(value, Table))
    .map((table) => getTableName(table))
    .sort()
}

function tablesWithOrganizationColumn(): Set<string> {
  return new Set(
    (Object.values(schema) as unknown[])
      .filter((value): value is Table => is(value, Table))
      .filter((table) => 'organizationId' in table)
      .map((table) => getTableName(table))
  )
}

function tableNameAt(tokens: SqlToken[], at: number): { name: string; index: number } | undefined {
  let index = at
  while (['if', 'exists', 'only'].some((text) => word(tokens[index], text))) index += 1
  const token = tokens[index]
  return token?.kind === 'word' || token?.kind === 'quoted' ? { name: token.text, index } : undefined
}

function removedTables(): Set<string> {
  const removed = new Set<string>()
  for (const { statements } of MIGRATIONS) {
    for (const { tokens } of statements) {
      tokens.forEach((token, i) => {
        if (word(token, 'drop') && word(tokens[i + 1], 'table')) {
          const dropped = tableNameAt(tokens, i + 2)
          if (dropped) removed.add(dropped.name)
        }
        if (word(token, 'alter') && word(tokens[i + 1], 'table')) {
          const renamed = tableNameAt(tokens, i + 2)
          if (renamed && word(tokens[renamed.index + 1], 'rename') && word(tokens[renamed.index + 2], 'to')) {
            removed.add(renamed.name)
          }
        }
      })
    }
  }
  return removed
}

function duplicatedWithinAMigration(): string[] {
  return MIGRATIONS.flatMap(({ file, statements }) => {
    const tables = helperCalls(statements, [...TENANT_HELPERS, ...PLATFORM_HELPERS]).map(({ table }) => table)
    return tables.filter((table, index) => tables.indexOf(table) !== index).map((table) => `${file}: ${table}`)
  })
}

function namesCurrentOrg(predicate: string): boolean {
  const tokens = tokenizeSql(predicate).flat()
  return tokens.some(
    (token, i) =>
      word(token, 'organization_id') &&
      tokens[i + 1]?.text === '=' &&
      (word(tokens[i + 2], 'current_org') || word(tokens[i + 2], 'grid_current_org')) &&
      tokens[i + 3]?.text === '(' &&
      tokens[i + 4]?.text === ')'
  )
}

function isOnlyTrue(predicate: string): boolean {
  const tokens = tokenizeSql(predicate).flat()
  return tokens.length === 1 && word(tokens[0], 'true')
}

describe('row-level security coverage', () => {
  it('secures every table the drizzle schema declares', () => {
    const secured = new Set([...securedTables(TENANT_HELPERS), ...securedTables(PLATFORM_HELPERS)])
    const unsecured = declaredTables().filter((table) => !secured.has(table))

    expect(
      unsecured,
      `These tables are outside the tenant boundary. Add a secure_table() ` +
        `line for each one to a migration — see docs/database/row-level-security.md.`
    ).toEqual([])
  })

  it('secures no table that no longer exists', () => {
    const declared = new Set(declaredTables())
    const removed = removedTables()
    const secured = [...securedTables(TENANT_HELPERS), ...securedTables(PLATFORM_HELPERS)]
    const orphaned = secured.filter((table) => !declared.has(table) && !removed.has(table))

    expect(
      orphaned,
      'Secured tables that are neither in the schema nor dropped/renamed away by a ' +
        'migration — either the declaration was removed without a DROP or a RENAME, ' +
        'or a secure_table() line was left behind.'
    ).toEqual([])
  })

  it('secures each table exactly once per migration', () => {
    expect(
      duplicatedWithinAMigration(),
      'Tables secured twice in one migration — the policies would OR together.'
    ).toEqual([])
  })

  it('keeps platform configuration out of the tenant-predicate set', () => {
    const tenant = securedTables(TENANT_HELPERS)
    const platform = securedTables(PLATFORM_HELPERS)

    expect(
      platform.length,
      'No table is secured by the platform helper: it was renamed or dropped.'
    ).toBeGreaterThan(0)
    expect(
      platform.filter((table) => tenant.includes(table)),
      'Tables secured by both helpers: their policies would OR together.'
    ).toEqual([])
    expect(
      tenant.filter((table) => table.startsWith('platform_')),
      'Platform configuration is secured with the tenant helper. Use secure_platform_table().'
    ).toEqual([])
  })
})

describe('policy predicates say what they should', () => {
  it('ties every table that has an organization_id to current_org()', () => {
    const withOrgColumn = tablesWithOrganizationColumn()
    const wrong = [...predicates()]
      .filter(([table, predicate]) => withOrgColumn.has(table) && !namesCurrentOrg(predicate))
      .map(([table]) => table)

    expect(
      wrong,
      'These tables carry organization_id but their policy does not compare it to ' +
        'current_org(). Without that half, a row with a NULL optional foreign ' +
        'key is readable by every tenant.'
    ).toEqual([])
  })

  it('has no policy that matches everything', () => {
    const permissive = [...predicates()].filter(([, predicate]) => isOnlyTrue(predicate)).map(([table]) => table)
    expect(permissive, 'A predicate of `true` secures nothing.').toEqual([])
  })
})
