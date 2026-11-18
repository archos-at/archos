// @disk-inputs: migrations/0*.sql, tests/fixtures/base-knowledge.schema.json
/**
 * @vitest-environment node
 *
 * One source for every word of the base knowledge records (`./vocab.ts`). The
 * migration's CHECKs must list exactly these values, and the committed fixture
 * the Python tier reads is written from them: `UPDATE_FIXTURES=1` rewrites it,
 * otherwise it is compared. A word added here without its CHECK (or the other
 * way round) fails before a write could.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { constraintClauses, listedValues, readSql, type SqlStatement } from '@/test-utils/sql-statements'
import { DECISION_TABLE_PURPOSES, KNOWLEDGE_VOCABULARIES } from './vocab'

const MIGRATION_FILES = readdirSync(join(process.cwd(), 'migrations'))
  .filter((name) => /^\d{4}_.+\.sql$/.test(name) && !name.endsWith('.down.sql'))
  .sort()
const MIGRATIONS: SqlStatement[][] = MIGRATION_FILES.map((name) => readSql(join(process.cwd(), 'migrations', name)))
const NEWEST_FIRST = [...MIGRATIONS].reverse()
const FIXTURE = join(process.cwd(), 'tests/fixtures/base-knowledge.schema.json')

function checkedValues(table: string, column: string): string[] {
  for (const statements of NEWEST_FIRST) {
    for (const clause of constraintClauses(statements)) {
      if (!clause.name.startsWith(`${table}_`) || !clause.check) continue
      const values = listedValues(clause.check, column)
      if (values.length > 0) return values
    }
  }
  return []
}

function vocabularySchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'base-knowledge.schema.json',
    description:
      'The closed vocabularies of the base knowledge records (ADR-0163). Generated from apps/workspace/bff/base-knowledge/wire/vocab.ts by its spec; do not edit.',
    $defs: Object.fromEntries(
      Object.entries(KNOWLEDGE_VOCABULARIES).map(([column, values]) => [column, { type: 'string', enum: [...values] }]),
    ),
  }
}

describe('the base knowledge vocabularies', () => {
  it.each(Object.entries(KNOWLEDGE_VOCABULARIES))('%s is what its CHECK lists', (qualified, values) => {
    const [table, column] = qualified.split('.')
    expect(checkedValues(table, column).sort()).toEqual([...values].sort())
  })

  it('holds no CHECK on a source\'s protocol or format: the Python registry is their one list', () => {
    const latest = (constraint: string): 'added' | 'dropped' | undefined => {
      for (const statements of NEWEST_FIRST) {
        const clauses = constraintClauses(statements).filter((clause) => clause.name === constraint)
        if (clauses.some((clause) => clause.action === 'DROP')) return 'dropped'
        if (clauses.some((clause) => clause.check)) return 'added'
      }
      return undefined
    }
    expect(latest('knowledge_source_revisions_protocol_known')).toBe('dropped')
    expect(latest('knowledge_source_revisions_format_known')).toBe('dropped')
    expect(Object.keys(KNOWLEDGE_VOCABULARIES)).not.toContain('knowledge_source_revisions.format')
  })

  it('allows a decision table only for the purposes the wire gives one', () => {
    const rulesets = MIGRATIONS[MIGRATION_FILES.indexOf('0204_rulesets.sql')] ?? []
    const purpose = constraintClauses(rulesets).find((clause) => clause.name === 'knowledge_ruleset_revisions_table_purpose')?.check ?? []
    expect(listedValues(purpose, 'purpose').sort()).toEqual([...DECISION_TABLE_PURPOSES].sort())
  })

  it('matches the committed fixture the Python tier reads', () => {
    const generated = `${JSON.stringify(vocabularySchema(), null, 2)}\n`
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(FIXTURE, generated, 'utf8')
    expect(
      readFileSync(FIXTURE, 'utf8'),
      'The vocabularies changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture in the same change.',
    ).toBe(generated)
  })
})
