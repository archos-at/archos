// @disk-inputs: migrations/0149_piloti_wakes_document_idx.down.sql, migrations/0149_piloti_wakes_document_idx.sql, migrations/0242_agent_actor_kind.down.sql, migrations/0242_agent_actor_kind.sql, migrations/meta/_journal.json
/**
 * @vitest-environment node
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTableConfig, IndexedColumn } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { constraintClauses, parseSql, readSql, type SqlStatement } from '@/test-utils/sql-statements'
import { documentAnnotations, pilotiWakes } from './document-annotations'
import { LEGACY_AGENT_KIND } from '@/lib/legacy-agent-kind'

const BUILT_AS = 'idx_piloti_wakes_document_annotation_created'
const NAME = 'idx_agent_wakes_document_annotation_created'
const migration = (file: string) => readSql(join(process.cwd(), 'migrations', file))
const tokensOf = (sql: string) => parseSql(sql)[0]!.tokens
const statementTokens = (statements: SqlStatement[]) => statements.map((statement) => statement.tokens)
const checkOf = (statements: SqlStatement[], name: string) =>
  constraintClauses(statements).find((clause) => clause.name === name && clause.check)?.check

describe('the index of a document’s wakes (migration 0149)', () => {
  it('is declared on the table: the document, then the mark, newest wake first', () => {
    const index = getTableConfig(pilotiWakes).indexes.find((entry) => entry.config.name === NAME)
    expect(index, `agent_wakes declares no ${NAME}`).toBeDefined()
    const columns = (index?.config.columns ?? []).map((column) =>
      column instanceof IndexedColumn ? `${column.name} ${column.indexConfig?.order ?? 'asc'}` : 'expression'
    )
    expect(columns).toEqual(['document_id asc', 'annotation_id asc', 'created_at desc'])
  })

  it('is built by the migration with the same columns, and the journal runs it', () => {
    expect(statementTokens(migration('0149_piloti_wakes_document_idx.sql'))).toContainEqual(
      tokensOf(`CREATE INDEX IF NOT EXISTS "${BUILT_AS}" ON "piloti_wakes" ("document_id", "annotation_id", "created_at" DESC)`)
    )
    const journal = JSON.parse(readFileSync(join(process.cwd(), 'migrations', 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ tag: string }>
    }
    expect(journal.entries.map((entry) => entry.tag)).toContain('0149_piloti_wakes_document_idx')
  })

  it('is dropped on the way down', () => {
    expect(statementTokens(migration('0149_piloti_wakes_document_idx.down.sql'))).toContainEqual(
      tokensOf(`DROP INDEX IF EXISTS "${BUILT_AS}"`)
    )
  })
})

describe('the actor kind of a mark, a reply and a proposal (migration 0242)', () => {
  it('the schema names the two constraints for the new value', () => {
    const checks = getTableConfig(documentAnnotations).checks.map((check) => check.name)
    expect(checks).toEqual(
      expect.arrayContaining(['document_annotations_only_agent_proposes', 'document_annotations_agent_needs_a_person'])
    )
  })

  it('the migration widens each CHECK that allowed the old value, and keeps the old value allowed', () => {
    const up = migration('0242_agent_actor_kind.sql')
    expect(checkOf(up, 'document_annotations_author_known')).toEqual(
      tokensOf(`"author_kind" IN ('person', 'agent', '${LEGACY_AGENT_KIND}')`)
    )
    expect(checkOf(up, 'proposed_changes_proposer_known')).toEqual(
      tokensOf(`"proposed_by_kind" IN ('${LEGACY_AGENT_KIND}', 'person', 'agent')`)
    )
    const names = constraintClauses(up).map((clause) => clause.name)
    expect(names).toContain('document_annotations_only_agent_proposes')
    expect(names).toContain('document_annotations_agent_needs_a_person')
  })

  it('the migration rewrites no row: the writers keep the old value until the switch', () => {
    const words = migration('0242_agent_actor_kind.sql').flatMap((statement) => statement.tokens)
    expect(words.some((token) => token.kind === 'word' && token.text.toUpperCase() === 'UPDATE')).toBe(false)
  })

  it('the down migration moves the new value back and restores the narrower CHECK', () => {
    const down = migration('0242_agent_actor_kind.down.sql')
    expect(statementTokens(down)).toContainEqual(
      tokensOf(`UPDATE document_annotations SET "author_kind" = '${LEGACY_AGENT_KIND}' WHERE "author_kind" = 'agent'`)
    )
    expect(checkOf(down, 'document_annotations_author_known')).toEqual(tokensOf(`"author_kind" IN ('person', '${LEGACY_AGENT_KIND}')`))
  })
})
