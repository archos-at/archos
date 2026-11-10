// @disk-inputs: migrations/0202_base_knowledge.sql, migrations/0204_rulesets.sql, migrations/0205_platform_base_knowledge.sql, migrations/0207_setup_fact_records.sql, tests/fixtures/base-knowledge.schema.json
/**
 * @vitest-environment node
 *
 * One source for every word of the base knowledge records (`./vocab.ts`). The
 * migration's CHECKs must list exactly these values, and the committed fixture
 * the Python tier reads is written from them: `UPDATE_FIXTURES=1` rewrites it,
 * otherwise it is compared. A word added here without its CHECK (or the other
 * way round) fails before a write could.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DECISION_TABLE_PURPOSES, KNOWLEDGE_VOCABULARIES } from './vocab'

/** Oldest first: a later migration that redefines a CHECK wins. */
const MIGRATIONS = [
  'migrations/0202_base_knowledge.sql',
  'migrations/0204_rulesets.sql',
  'migrations/0205_platform_base_knowledge.sql',
  'migrations/0207_setup_fact_records.sql',
].map((path) =>
  readFileSync(join(process.cwd(), path), 'utf8'),
)
const FIXTURE = join(process.cwd(), 'tests/fixtures/base-knowledge.schema.json')

/**
 * The values a CHECK of `table` on `column` lists: `CONSTRAINT <table>_… CHECK
 * (… "column" IN ('a', 'b'))`, across line breaks. The table is named because
 * two tables share a column name (`kind` of a work and of a territory). The
 * newest migration that names it decides, and within one the first CHECK, which
 * is the column's own `_known` constraint. With `source`, that text alone.
 */
function checkedValues(table: string, column: string, source?: string): string[] {
  const owner = source ? '' : `CONSTRAINT ${table}_\\w+\\s+CHECK \\([^)]*?`
  const pattern = new RegExp(`${owner}"${column}"\\s+IN\\s*\\(([^)]*)\\)`)
  const match = (source ? [source] : [...MIGRATIONS].reverse()).map((text) => pattern.exec(text)).find(Boolean)
  if (!match) return []
  return [...match[1].matchAll(/'([^']+)'/g)].map((value) => value[1])
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

  it('allows a decision table only for the purposes the wire gives one', () => {
    const constraint = /knowledge_ruleset_revisions_table_purpose CHECK \(([^;]*?)\),\n/.exec(MIGRATIONS[1])?.[1] ?? ''
    expect(checkedValues('knowledge_ruleset_revisions', 'purpose', constraint).sort()).toEqual([...DECISION_TABLE_PURPOSES].sort())
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
