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

/** The released sources with a `lookup` block for `countries`, by key; at most {@link MAX_CONTEXT_SOURCES}. */
export async function lookupSourcesFor(countries: readonly string[]): Promise<ContextSource[]> {
  if (countries.length === 0) return []
  const rows = await withPlatformAccess('knowledge context: the released sources a turn may look law up in', () =>
    getDb().execute<SourceRow>(sql`
      SELECT r.id AS record_id, b.revision_id, r.country_id, b.config
      FROM knowledge_records r JOIN knowledge_source_revisions b ON b.revision_id = r.head_revision_id
      WHERE r.type = 'source' AND r.organization_id IS NULL AND r.country_id = ANY(${sqlTextArray([...countries])})
        AND b.config ? 'lookup'
      ORDER BY r.id`),
  )
  const sources: ContextSource[] = []
  for (const row of rows) {
    const config = lookupConfig(row.config)
    if (!config) {
      console.error('[knowledge_context_source_dropped=true] a source configuration is larger than a turn carries', { recordId: row.record_id })
      continue
    }
    sources.push({ key: sourceKeyOf(row.record_id), revisionId: row.revision_id, country: row.country_id, config })
    if (sources.length === MAX_CONTEXT_SOURCES) break
  }
  return sources
}
