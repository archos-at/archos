/**
 * The public sources a turn may look law up in (country-as-data plan, step 4):
 * the released source records of the countries the turn reads, each with the
 * configuration a law lookup reads (`lookup` block, access, engine).
 *
 * Which source answers a lookup is the record's country, never a table in code
 * (`law_gate.LAW_SOURCE_COUNTRIES` is what this replaces). A source with no
 * `lookup` block is not one a lookup reads, and is left out. A record's
 * fixtures proved it before it was released and are not sent: the agent
 * parses a released record without them (`public_sources.source.parse_released_source`).
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { sqlTextArray } from '@/lib/db/sql-list'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { sourceKeyOf } from '../platform/sources'
import { MAX_CONTEXT_SOURCES, MAX_SOURCE_CONFIG_CHARS, type ContextSource } from './wire'

interface SourceRow extends Record<string, unknown> {
  record_id: string
  revision_id: string
  country_id: string
  config: Record<string, unknown>
}

/** A released record's configuration as the lookup reads it: without the fixtures that proved it. */
export function lookupConfig(config: Record<string, unknown>): Record<string, unknown> | null {
  if (!config.lookup) return null
  const { fixtures: _proved, ...rest } = config
  return JSON.stringify(rest).length <= MAX_SOURCE_CONFIG_CHARS ? rest : null
}

/** What a turn carries of its sources: those it may read, and the keys of those it could not carry. */
export interface TurnSources {
  sources: ContextSource[]
  /** Released sources left out: a configuration too large to carry, or past {@link MAX_CONTEXT_SOURCES}. */
  dropped: string[]
}

/**
 * The released sources with a `lookup` block for `countries`, by key; at most {@link MAX_CONTEXT_SOURCES}.
 * One left out is named in `dropped`, so the turn can say which source it could not read (never silently).
 */
export async function lookupSourcesFor(countries: readonly string[]): Promise<TurnSources> {
  if (countries.length === 0) return { sources: [], dropped: [] }
  const rows = await withPlatformAccess('knowledge context: the released sources a turn may look law up in', () =>
    getDb().execute<SourceRow>(sql`
      SELECT r.id AS record_id, b.revision_id, r.country_id, b.config - 'fixtures' AS config
      FROM knowledge_records r JOIN knowledge_source_revisions b ON b.revision_id = r.head_revision_id
      WHERE r.type = 'source' AND r.organization_id IS NULL AND r.country_id = ANY(${sqlTextArray([...countries])})
        AND b.config ? 'lookup'
      ORDER BY r.id`),
  )
  const sources: ContextSource[] = []
  const dropped: string[] = []
  for (const row of rows) {
    const key = sourceKeyOf(row.record_id)
    const config = sources.length < MAX_CONTEXT_SOURCES ? lookupConfig(row.config) : null
    if (!config) {
      dropped.push(key)
      continue
    }
    sources.push({ key, revisionId: row.revision_id, country: row.country_id, config })
  }
  if (dropped.length > 0) {
    console.error('[knowledge_context_source_dropped=true] a released source could not be carried by the turn', { dropped })
  }
  return { sources, dropped: dropped.slice(0, MAX_CONTEXT_SOURCES) }
}
