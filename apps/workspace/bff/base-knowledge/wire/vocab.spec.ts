// @disk-inputs: migrations/0202_base_knowledge.sql, migrations/0205_platform_base_knowledge.sql, tests/fixtures/base-knowledge.schema.json
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
import { KNOWLEDGE_VOCABULARIES } from './vocab'

/** In order: a later migration's CHECK on a column replaces an earlier one (0205 widens the record types). */
const MIGRATIONS = ['migrations/0202_base_knowledge.sql', 'migrations/0205_platform_base_knowledge.sql'].map((path) =>
  readFileSync(join(process.cwd(), path), 'utf8'),
)
const FIXTURE = join(process.cwd(), 'tests/fixtures/base-knowledge.schema.json')

/**
 * The values the newest CHECK of `table` on `column` lists:
 * `CONSTRAINT <table>_… CHECK ("column" IN ('a', 'b'))`, across line breaks.
 */
function checkedValues(table: string, column: string): string[] {
  const pattern = new RegExp(`CONSTRAINT ${table}_\\w+\\s+CHECK \\(\\s*"${column}"\\s+IN\\s*\\(([^)]*)\\)`, 'g')
  const matches = MIGRATIONS.flatMap((migration) => [...migration.matchAll(pattern)])
  const newest = matches.at(-1)
  if (!newest) return []
  return [...newest[1].matchAll(/'([^']+)'/g)].map((value) => value[1])
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

  it('matches the committed fixture the Python tier reads', () => {
    const generated = `${JSON.stringify(vocabularySchema(), null, 2)}\n`
    if (process.env.UPDATE_FIXTURES === '1') writeFileSync(FIXTURE, generated, 'utf8')
    expect(
      readFileSync(FIXTURE, 'utf8'),
      'The vocabularies changed. Re-run with UPDATE_FIXTURES=1 and commit the fixture in the same change.',
    ).toBe(generated)
  })
})
