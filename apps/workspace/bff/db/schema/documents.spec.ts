// @disk-inputs: migrations/0049_session_documents.sql, migrations/0063_agent_authored_documents.sql, migrations/0064_generated_document_idempotency.sql, migrations/0065_diagram_document_producer_idempotency.sql, migrations/0066_authored_ref_names_its_kind.sql, migrations/0102_archiv_folders.sql, bff/documents/repository.ts, bff/documents/repository/*.ts
/**
 * @vitest-environment node
 */

import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { getTableColumns } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { AUTHORED_REF_KINDS, DOCUMENT_AUTHORS, documents } from './documents'
import { GENERATED_DOCUMENT_PRODUCER_REF_KINDS } from '@/lib/documents/generated'
import { projectFolders } from './project-folders'
import { IN_FLIGHT_DOCUMENT_STATUSES } from '@/lib/documents/document-status'
import { callsTo, nodesOf, parseSource, ts } from '@/test-utils/source-ast'
import { parseSql, readSql, startsWith, type SqlStatement, type SqlToken } from '@/test-utils/sql-statements'

const CONSTRAINT = 'documents_session_requires_conversation'
const AUTHORSHIP_CONSTRAINT = 'documents_authorship_requires_provenance'
const AGENT_INDEX = 'documents_agent_authored_idx'
const FOLDER_INDEX = 'uniq_project_folders_parent_name'
const IDEMPOTENCY_INDEX = 'uniq_documents_authored_ref_producer_per_project'
const PROBE = 'findDocumentAuthoredByRef'
const PROBE_FILE = 'bff/documents/repository/lookup-by-ref.ts'

const SESSION_MIGRATION = readSql('migrations/0049_session_documents.sql')
const AGENT_MIGRATION = readSql('migrations/0063_agent_authored_documents.sql')
const AUTHORSHIP_MIGRATION = readSql('migrations/0066_authored_ref_names_its_kind.sql')
const FOLDER_MIGRATION = readSql('migrations/0111_project_folder_grants.sql')

const EXPECTED =
  "(scope = 'session') = (conversation_id is not null) and (scope <> 'session' or project_id is null)"

const EXPECTED_AUTHORSHIP =
  "authored_by = 'user' or (authored_by_producer is not null and authored_by_ref is not null and authored_by_ref_kind is not null)"

function inFlightStatuses(): string[] {
  return [...IN_FLIGHT_DOCUMENT_STATUSES]
}

function canonical(expression: string): string {
  return expression
    .replace(/"documents"\./g, '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function schemaCheckBody(constraint: string): string {
  const check = getTableConfig(documents).checks.find((entry) => entry.name === constraint)
  if (!check) throw new Error(`the drizzle table declares no ${constraint} check`)
  return new PgDialect().sqlToQuery(check.value).sql
}

function schemaTokens(constraint: string): SqlToken[] {
  const statement = parseSql(schemaCheckBody(constraint))[0]
  if (!statement) throw new Error(`the drizzle table renders no ${constraint} expression`)
  return statement.tokens
}

function isSymbol(token: SqlToken | undefined, text: string): boolean {
  return token?.kind === 'symbol' && token.text === text
}

function parenthesised(tokens: SqlToken[], open: number): SqlToken[] {
  if (!isSymbol(tokens[open], '(')) throw new Error('a migration statement opens no parenthesis where expected')
  let depth = 0
  for (let i = open; i < tokens.length; i += 1) {
    if (isSymbol(tokens[i], '(')) depth += 1
    else if (isSymbol(tokens[i], ')')) {
      depth -= 1
      if (depth === 0) return tokens.slice(open + 1, i)
    }
  }
  throw new Error('a migration statement has unbalanced parentheses')
}

function splitTopLevel(tokens: SqlToken[]): SqlToken[][] {
  const parts: SqlToken[][] = []
  let current: SqlToken[] = []
  let depth = 0
  for (const token of tokens) {
    if (isSymbol(token, '(')) depth += 1
    if (isSymbol(token, ')')) depth -= 1
    if (depth === 0 && isSymbol(token, ',')) {
      parts.push(current)
      current = []
    } else current.push(token)
  }
  return [...parts, current]
}

function keyOf(part: SqlToken[]): string {
  const coalesce = part.findIndex((token) => token.kind === 'word' && token.text.toLowerCase() === 'coalesce')
  if (coalesce >= 0) return `coalesce(${part[coalesce + 2]?.text})`
  return part.find((token) => token.kind === 'quoted' || token.kind === 'word')?.text ?? ''
}

function indexKeys(statement: SqlToken[]): string[] {
  const on = statement.findIndex((token) => token.kind === 'word' && token.text.toUpperCase() === 'ON')
  const open = statement.findIndex((token, i) => i > on && isSymbol(token, '('))
  return splitTopLevel(parenthesised(statement, open)).map(keyOf)
}

function shape(tokens: SqlToken[]): string[] {
  const out: string[] = []
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]
    if (token.kind !== 'string' && token.text === 'documents' && isSymbol(tokens[i + 1], '.')) i += 1
    else if (isSymbol(token, '<') && isSymbol(tokens[i + 1], '>')) {
      out.push('<>')
      i += 1
    } else out.push(token.kind === 'string' ? `'${token.text}'` : token.text.toLowerCase())
  }
  return out
}

function whereText(statement: SqlToken[]): string {
  const at = statement.findIndex((token) => token.kind === 'word' && token.text.toUpperCase() === 'WHERE')
  if (at < 0) throw new Error('the index declares no WHERE predicate')
  return shape(statement.slice(at + 1)).join(' ')
}

function createdIndex(migration: SqlStatement[], name: string): SqlStatement {
  const found = migration.find(
    (statement) =>
      startsWith(statement, 'CREATE') && statement.tokens.some((token) => token.kind === 'quoted' && token.text === name),
  )
  if (!found) throw new Error(`the migration creates no index ${name}`)
  return found
}

function checkBody(migration: SqlStatement[], name: string): SqlToken[] {
  for (const { tokens } of migration) {
    const at = tokens.findIndex(
      (token, i) =>
        token.kind === 'quoted' &&
        token.text === name &&
        tokens[i - 1]?.text.toUpperCase() === 'CONSTRAINT' &&
        tokens[i + 1]?.text.toUpperCase() === 'CHECK',
    )
    if (at >= 0) return parenthesised(tokens, at + 2)
  }
  throw new Error(`the migration adds no CHECK ${name}`)
}

const SQL_NAME = new Map(
  Object.entries(getTableColumns(documents)).map(([key, column]): [string, string] => [key, column.name]),
)

function probeFunction(): ts.FunctionDeclaration {
  const found = nodesOf(parseSource(PROBE_FILE), ts.isFunctionDeclaration).find((fn) => fn.name?.text === PROBE)
  if (!found) throw new Error(`${PROBE_FILE} no longer declares ${PROBE}`)
  return found
}

function filteredColumn(node: ts.Expression | undefined): string {
  if (!node || !ts.isPropertyAccessExpression(node) || !ts.isIdentifier(node.expression) || node.expression.text !== 'documents') {
    throw new Error(`${PROBE} filters on something other than a documents column`)
  }
  return SQL_NAME.get(node.name.text) ?? node.name.text
}

function literal(node: ts.Expression | undefined): string {
  return node && ts.isStringLiteral(node) ? `'${node.text}'` : ''
}

function probeEquals(): string[] {
  return callsTo(probeFunction(), 'eq')
    .map((call) => filteredColumn(call.arguments[0]))
    .sort()
}

function probeNotEquals(): string[] {
  return callsTo(probeFunction(), 'ne').map(
    (call) => `${filteredColumn(call.arguments[0])} <> ${literal(call.arguments[1])}`,
  )
}

describe('the documents scope partition', () => {
  it('keeps the two spellings identical', () => {
    expect(shape(checkBody(SESSION_MIGRATION, CONSTRAINT))).toEqual(shape(schemaTokens(CONSTRAINT)))
  })

  it('states the same rule in the drizzle table, not a weaker one', () => {
    expect(canonical(schemaCheckBody(CONSTRAINT))).toBe(EXPECTED)
  })
})

describe('authorship on documents', () => {
  it('keeps the two spellings identical', () => {
    expect(shape(checkBody(AUTHORSHIP_MIGRATION, AUTHORSHIP_CONSTRAINT))).toEqual(
      shape(schemaTokens(AUTHORSHIP_CONSTRAINT)),
    )
  })

  it('states the same rule in the drizzle table, not a weaker one', () => {
    expect(canonical(schemaCheckBody(AUTHORSHIP_CONSTRAINT))).toBe(EXPECTED_AUTHORSHIP)
  })

  it('gives every producer a reference kind, so none can be filed unresolvable', () => {
    for (const kind of Object.values(GENERATED_DOCUMENT_PRODUCER_REF_KINDS)) {
      expect(AUTHORED_REF_KINDS).toContain(kind)
    }
    expect(Object.keys(GENERATED_DOCUMENT_PRODUCER_REF_KINDS).length).toBeGreaterThan(0)
  })

  it('exempts the one author that IS its own provenance, and nothing else', () => {
    const column = getTableConfig(documents).columns.find((entry) => entry.name === 'authored_by')
    expect(column?.default).toBe(DOCUMENT_AUTHORS[0])
    expect(DOCUMENT_AUTHORS[0]).toBe('user')
  })

  it('names no producer, so a new author arrives already constrained', () => {
    const body = canonical(schemaCheckBody(AUTHORSHIP_CONSTRAINT))
    for (const author of DOCUMENT_AUTHORS.slice(1)) {
      expect(body).not.toContain(`'${author}'`)
    }
  })
})

describe('the indexes drizzle cannot declare', () => {
  it('keeps documents_agent_authored_idx partial, and only in the migration', () => {
    const declared = getTableConfig(documents).indexes.map((entry) => entry.config.name)
    expect(declared).not.toContain(AGENT_INDEX)
    const statement = createdIndex(AGENT_MIGRATION, AGENT_INDEX)
    expect(indexKeys(statement.tokens)).toEqual(['project_id', 'created_at'])
    expect(whereText(statement.tokens)).toBe("authored_by = 'agent'")
  })

  it('does not declare uniq_project_folders_parent_name in drizzle, so only the migrations build it', () => {
    const folders = getTableConfig(projectFolders)
    const declared = [
      ...folders.indexes.map((entry) => entry.config.name),
      ...folders.uniqueConstraints.map((entry) => entry.name),
    ]
    expect(declared).not.toContain(FOLDER_INDEX)
  })

  it('keys the folder-name index on both shelves, COALESCE-keyed on the project and the parent', () => {
    expect(indexKeys(createdIndex(FOLDER_MIGRATION, FOLDER_INDEX).tokens)).toEqual([
      'organization_id',
      'coalesce(project_id)',
      'coalesce(parent_id)',
      'name',
    ])
  })

  it('declares the shelf constraints the migration adds, so provisioning from the schema builds them', () => {
    const folders = getTableConfig(projectFolders)
    expect(folders.uniqueConstraints.map((entry) => entry.name)).toContain(
      'project_folders_id_organization_id_scope_key'
    )
    expect(folders.checks.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(['project_folders_scope_check', 'project_folders_scope_owner_check'])
    )
    expect(folders.foreignKeys.map((entry) => entry.getName())).toContain(
      'project_folders_parent_id_organization_id_scope_fkey'
    )
    expect(getTableConfig(documents).foreignKeys.map((entry) => entry.getName())).toContain(
      'documents_folder_id_organization_id_scope_fkey'
    )
  })
})

describe('the idempotency index and the probe it belongs to', () => {
  it('keys on exactly the columns the probe filters by', () => {
    expect(probeEquals()).toEqual(['authored_by_producer', 'authored_by_ref', 'organization_id', 'project_id'])
    expect(indexKeys(createdIndex(AUTHORSHIP_MIGRATION, IDEMPOTENCY_INDEX).tokens).sort()).toEqual(probeEquals())
  })

  it('is UNIQUE and partial on <> user, so a human row is never rejected', () => {
    const statement = createdIndex(AUTHORSHIP_MIGRATION, IDEMPOTENCY_INDEX)
    expect(startsWith(statement, 'CREATE', 'UNIQUE', 'INDEX')).toBe(true)
    expect(whereText(statement.tokens)).toBe("authored_by <> 'user'")
  })

  it('applies the index’s predicate in the probe too, not only its columns', () => {
    expect(probeNotEquals()).toEqual([whereText(createdIndex(AUTHORSHIP_MIGRATION, IDEMPOTENCY_INDEX).tokens)])
  })

  it('lives only in the migration, like every other partial index here', () => {
    const declared = [
      ...getTableConfig(documents).indexes.map((entry) => entry.config.name),
      ...getTableConfig(documents).uniqueConstraints.map((entry) => entry.name),
    ]
    expect(declared).not.toContain(IDEMPOTENCY_INDEX)
  })
})

describe('a stored document is terminal', () => {
  it('is never polled, because the poller has no in-flight entry for it', () => {
    expect(inFlightStatuses()).not.toContain('stored')
  })

  it('leaves the states that ARE in flight alone', () => {
    expect(inFlightStatuses()).toContain('pending')
  })
})
