// @disk-inputs: migrations/0049_session_documents.sql, migrations/0063_agent_authored_documents.sql, migrations/0064_generated_document_idempotency.sql, migrations/0065_diagram_document_producer_idempotency.sql, migrations/0066_authored_ref_names_its_kind.sql, migrations/0102_archiv_folders.sql, bff/documents/repository.ts, bff/documents/repository/*.ts
/**
 * @vitest-environment node
 */

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { AUTHORED_REF_KINDS, DOCUMENT_AUTHORS, documents } from './documents'
import { GENERATED_DOCUMENT_PRODUCER_REF_KINDS } from '@/lib/documents/generated'
import { projectFolders } from './project-folders'
import { IN_FLIGHT_DOCUMENT_STATUSES } from '@/lib/documents/document-status'

const CONSTRAINT = 'documents_session_requires_conversation'

const MIGRATION = readFileSync(join(process.cwd(), 'migrations/0049_session_documents.sql'), 'utf8')

const AUTHORSHIP_CONSTRAINT = 'documents_authorship_requires_provenance'

const MIGRATION_0063 = readFileSync(
  join(process.cwd(), 'migrations/0063_agent_authored_documents.sql'),
  'utf8'
)

const MIGRATION_0064 = readFileSync(
  join(process.cwd(), 'migrations/0064_generated_document_idempotency.sql'),
  'utf8'
)
const MIGRATION_0065 = readFileSync(
  join(process.cwd(), 'migrations/0065_diagram_document_producer_idempotency.sql'),
  'utf8'
)
const MIGRATION_0066 = readFileSync(
  join(process.cwd(), 'migrations/0066_authored_ref_names_its_kind.sql'),
  'utf8'
)

const REPOSITORY_DIR = join(process.cwd(), 'bff/documents/repository')
const DOCUMENTS_REPOSITORY = [
  join(process.cwd(), 'bff/documents/repository.ts'),
  ...readdirSync(REPOSITORY_DIR).map((name) => join(REPOSITORY_DIR, name)),
]
  .map((file) => readFileSync(file, 'utf8'))
  .join('\n')

const IDEMPOTENCY_INDEX = 'uniq_documents_authored_ref_producer_per_project'
const SUPERSEDED_INDEX = 'uniq_documents_authored_run_per_project'
const RENAMED_INDEX = 'uniq_documents_authored_run_producer_per_project'

function statement(sql: string): RegExp {
  return new RegExp(`^${sql.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'm')
}

function indexColumns(migration: string, name: string): string[] {
  const match = migration.match(
    new RegExp(`CREATE UNIQUE INDEX "${name}"\\s*ON "documents" \\(([^)]*)\\)`)
  )
  if (!match) throw new Error(`the migration declares no ${name}`)
  return match[1].split(',').map((column) => column.trim().replace(/"/g, ''))
}

function probeColumns(): string[] {
  const start = DOCUMENTS_REPOSITORY.indexOf('export async function findDocumentAuthoredByRef')
  expect(start, 'findDocumentAuthoredByRef still exists').toBeGreaterThan(-1)
  const rest = DOCUMENTS_REPOSITORY.slice(start + 1)
  const end = rest.indexOf('export async function')
  const body = end === -1 ? rest : rest.slice(0, end)
  return [...body.matchAll(/eq\(documents\.(\w+),/g)]
    .map(([, column]) => column.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`))
    .sort()
}

function probeAuthorshipPredicate(): string | null {
  const start = DOCUMENTS_REPOSITORY.indexOf('export async function findDocumentAuthoredByRef')
  expect(start, 'findDocumentAuthoredByRef still exists').toBeGreaterThan(-1)
  const rest = DOCUMENTS_REPOSITORY.slice(start + 1)
  const end = rest.indexOf('export async function')
  const body = end === -1 ? rest : rest.slice(0, end)
  const uncommented = body.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '')
  return /ne\(documents\.authoredBy,\s*'user'\)/.test(uncommented)
    ? "<> 'user'"
    : /eq\(documents\.authoredBy,\s*'agent'\)/.test(uncommented)
      ? "= 'agent'"
      : null
}

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

const EXPECTED =
  "(scope = 'session') = (conversation_id is not null) and (scope <> 'session' or project_id is null)"

function migrationCheckBody(source: string, constraint: string): string {
  const match = source.match(
    new RegExp(`ADD CONSTRAINT "${constraint}"\\s*CHECK\\s*\\(([\\s\\S]*?)\\)\\s*NOT VALID`)
  )
  if (!match) throw new Error(`the migration declares no ${constraint} CHECK`)
  return match[1]
}

function schemaCheckBody(constraint: string): string {
  const check = getTableConfig(documents).checks.find((entry) => entry.name === constraint)
  if (!check) throw new Error(`the drizzle table declares no ${constraint} check`)
  return new PgDialect().sqlToQuery(check.value).sql
}

describe('the documents scope partition', () => {
  it('forbids a session row from also naming a project (migration 0049)', () => {
    expect(canonical(migrationCheckBody(MIGRATION, CONSTRAINT))).toBe(EXPECTED)
  })

  it('states the same rule in the drizzle table, not a weaker one', () => {
    expect(canonical(schemaCheckBody(CONSTRAINT))).toBe(EXPECTED)
  })

  it('keeps the two spellings identical', () => {
    expect(canonical(schemaCheckBody(CONSTRAINT))).toBe(
      canonical(migrationCheckBody(MIGRATION, CONSTRAINT))
    )
  })
})

const EXPECTED_AUTHORSHIP =
  "authored_by = 'user' or (authored_by_producer is not null and authored_by_ref is not null and authored_by_ref_kind is not null)"

describe('authorship on documents', () => {
  it('makes a row no person wrote name its producer, its reference AND what that reference is', () => {
    expect(canonical(migrationCheckBody(MIGRATION_0066, AUTHORSHIP_CONSTRAINT))).toBe(
      EXPECTED_AUTHORSHIP
    )
  })

  it('states the same rule in the drizzle table, not a weaker one', () => {
    expect(canonical(schemaCheckBody(AUTHORSHIP_CONSTRAINT))).toBe(EXPECTED_AUTHORSHIP)
  })

  it('keeps the two spellings identical', () => {
    expect(canonical(schemaCheckBody(AUTHORSHIP_CONSTRAINT))).toBe(
      canonical(migrationCheckBody(MIGRATION_0066, AUTHORSHIP_CONSTRAINT))
    )
  })

  it('replaces 0063\u2019s constraint rather than adding a second one', () => {
    expect(MIGRATION_0066).toMatch(
      statement(`ALTER TABLE \"documents\" DROP CONSTRAINT \"${AUTHORSHIP_CONSTRAINT}\"`)
    )
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
    expect(declared).not.toContain('documents_agent_authored_idx')
    expect(MIGRATION_0063).toMatch(
      /CREATE INDEX "documents_agent_authored_idx"\s*ON "documents" \("project_id", "created_at" DESC\)\s*WHERE "authored_by" = 'agent'/
    )
  })

  it('keeps uniq_project_folders_parent_name COALESCE-keyed, and only in the migration', () => {
    const declared = [
      ...getTableConfig(projectFolders).indexes.map((entry) => entry.config.name),
      ...getTableConfig(projectFolders).uniqueConstraints.map((entry) => entry.name),
    ]
    expect(declared).not.toContain('uniq_project_folders_parent_name')
    expect(MIGRATION_0063).toMatch(
      /CREATE UNIQUE INDEX "uniq_project_folders_parent_name"[\s\S]*?coalesce\("parent_id"/
    )
  })

  it('widens the folder index to both shelves in 0102, COALESCE-keyed on the project too', () => {
    const widened = readFileSync(join(process.cwd(), 'migrations/0102_archiv_folders.sql'), 'utf8')
    expect(widened).toMatch(
      /CREATE UNIQUE INDEX "uniq_project_folders_parent_name"[\s\S]*?"organization_id"[\s\S]*?coalesce\("project_id"[\s\S]*?coalesce\("parent_id"/
    )
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
    expect(indexColumns(MIGRATION_0066, IDEMPOTENCY_INDEX).sort()).toEqual(probeColumns())
  })

  it('found real columns on both sides, not two empty lists', () => {
    expect(probeColumns()).toEqual([
      'authored_by_producer',
      'authored_by_ref',
      'organization_id',
      'project_id',
    ])
  })

  it('is UNIQUE and partial on <> user, so a human row is never rejected', () => {
    expect(MIGRATION_0066).toMatch(
      new RegExp(
        `CREATE UNIQUE INDEX "${IDEMPOTENCY_INDEX}"\\s*ON "documents" \\([^)]*\\)\\s*WHERE "authored_by" <> 'user'`
      )
    )
  })

  it('applies the index\u2019s predicate in the probe too, not only its columns', () => {
    expect(probeAuthorshipPredicate()).toBe("<> 'user'")
  })

  it('lives only in the migration, like every other partial index here', () => {
    const declared = [
      ...getTableConfig(documents).indexes.map((entry) => entry.config.name),
      ...getTableConfig(documents).uniqueConstraints.map((entry) => entry.name),
    ]
    expect(declared).not.toContain(IDEMPOTENCY_INDEX)
  })

  it('replaces 0064\u2019s index rather than standing beside it', () => {
    expect(MIGRATION_0064).toMatch(statement(`CREATE UNIQUE INDEX "${SUPERSEDED_INDEX}"`))
    expect(MIGRATION_0065).toMatch(statement(`DROP INDEX IF EXISTS "${SUPERSEDED_INDEX}"`))
    expect(MIGRATION_0065).not.toMatch(statement(`CREATE UNIQUE INDEX "${SUPERSEDED_INDEX}"`))
  })

  it('leaves no index behind under the name 0066 renamed away from', () => {
    expect(MIGRATION_0066).toMatch(statement(`CREATE UNIQUE INDEX "${IDEMPOTENCY_INDEX}"`))
    expect(MIGRATION_0066).toMatch(statement(`DROP INDEX IF EXISTS "${RENAMED_INDEX}"`))
    expect(MIGRATION_0066).not.toMatch(/^ALTER INDEX/m)
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
