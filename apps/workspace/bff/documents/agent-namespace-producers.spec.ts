// @disk-inputs: backfills/*/*.sql, migrations/*.sql

import { readdirSync } from 'node:fs'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import { parseSql, readSql, type SqlStatement } from '@/test-utils/sql-statements'
import { documents } from '@/lib/db/schema/documents'
import { NAMESPACED_AGENT_PRODUCERS } from './agent-namespace'

const LIVE_NAME_INDEX = 'uniq_documents_live_name_per_collection'
const FIX = 'NAMESPACED_AGENT_PRODUCERS (bff/documents/agent-namespace.ts) is the list; make this one follow it'

function withQuoted(statements: SqlStatement[]): SqlStatement[] {
  return statements.flatMap((statement) => {
    const quoted = statement.tokens.flatMap((token) => (token.kind === 'string' ? parseSql(token.text) : []))
    return [statement, ...withQuoted(quoted)]
  })
}

function producerLists(statements: SqlStatement[]): string[][] {
  return withQuoted(statements).flatMap(({ tokens }) =>
    tokens.flatMap((token, i) => {
      const listed =
        token.kind !== 'string' &&
        token.text === 'authored_by_producer' &&
        tokens[i + 1]?.text.toUpperCase() === 'IN' &&
        tokens[i + 2]?.text === '('
      if (!listed) return []
      const end = tokens.findIndex((t, j) => j > i + 2 && t.text === ')')
      const items = tokens.slice(i + 3, end)
      const literals = items.every((t, j) => (j % 2 === 0 ? t.kind === 'string' : t.text === ','))
      return literals && items.length > 0 ? [items.flatMap((t) => (t.kind === 'string' ? [t.text] : []))] : []
    }),
  )
}

const sorted = (list: readonly string[]) => [...list].sort()

const BACKFILL_SQL = readdirSync('backfills', { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .flatMap((entry) =>
    readdirSync(`backfills/${entry.name}`)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => `backfills/${entry.name}/${file}`),
  )

const LATEST_LIVE_NAME_MIGRATION = readdirSync('migrations')
  .filter((file) => file.endsWith('.sql') && !file.endsWith('.down.sql'))
  .sort()
  .map((file) => `migrations/${file}`)
  .filter((file) => readSql(file).some((statement) => statement.text.includes(LIVE_NAME_INDEX)))
  .at(-1)!

describe('the producers that file under the agent namespace are listed once', () => {
  it.each(BACKFILL_SQL)('%s lists them as NAMESPACED_AGENT_PRODUCERS does', (file) => {
    for (const list of producerLists(readSql(file))) {
      expect(sorted(list), `${file}: ${FIX}`).toEqual(sorted(NAMESPACED_AGENT_PRODUCERS))
    }
  })

  it('the latest migration on the live-name index lists them', () => {
    const lists = producerLists(readSql(LATEST_LIVE_NAME_MIGRATION))
    expect(lists.length, `${LATEST_LIVE_NAME_MIGRATION} names no producer`).toBeGreaterThan(0)
    for (const list of lists) {
      expect(
        sorted(list),
        `${LATEST_LIVE_NAME_MIGRATION}: ${FIX}, in a new migration that recreates ${LIVE_NAME_INDEX}`,
      ).toEqual(sorted(NAMESPACED_AGENT_PRODUCERS))
    }
  })

  it('the schema index on documents lists them', () => {
    const index = getTableConfig(documents).indexes.find((i) => i.config.name === LIVE_NAME_INDEX)
    const where = new PgDialect().sqlToQuery(index!.config.where!).sql
    const listed = [...(where.match(/in \(([^)]*)\)/i)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!)
    expect(sorted(listed), `bff/db/schema/documents.ts (${LIVE_NAME_INDEX}): ${FIX}`).toEqual(
      sorted(NAMESPACED_AGENT_PRODUCERS),
    )
  })
})
