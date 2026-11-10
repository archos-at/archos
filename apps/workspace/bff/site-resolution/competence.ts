/**
 * Which authority is competent for a site: the competence rulesets in force
 * for its chain, decided by the one evaluator (ADR-0166, `decide`), and the
 * authority records they name (ADR-0165). Nothing here knows a country.
 *
 * The facts a competence table may read, all territory ids of the site's
 * chain: `municipality` (`AT:gkz:60101`), `state` (`AT-6`), `country` (`AT`).
 * A table that reads another fact gets it as unknown and answers
 * `undetermined: unknown_inputs`, naming it. No ruleset for the chain is
 * `undetermined: no_rule`, never a guess; Austria's rulesets arrive with
 * pack 1 (build split S8).
 */

import 'server-only'
import { sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { readRulesetsInForce } from '@/lib/base-knowledge/store/rulesets'
import { decide, type StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import type { SiteAuthority } from './wire'

/** The facts a competence table reads, from a chain (leaf first: municipality, state, country). */
export function siteFacts(chain: readonly string[]): Record<string, string> {
  const [municipality, state, country] = chain.length >= 3 ? chain : [chain[0], undefined, chain[chain.length - 1]]
  return {
    ...(municipality ? { municipality } : {}),
    ...(state ? { state } : {}),
    ...(country ? { country } : {}),
  }
}

/** The evaluator's answer as the wire says it, with authority names from `names`. Pure. */
export function authorityOf(
  rulesets: readonly StoredRuleset[],
  chain: readonly string[],
  on: string,
  names: ReadonlyMap<string, string>
): SiteAuthority {
  const result = decide(rulesets, { purpose: 'competence', chain, on }, siteFacts(chain))
  if (result.status === 'decided') {
    const bodies = (result.then as { bodies: { authorityId: string; role: 'decides' | 'consents' | 'checks' }[] }).bodies
    return {
      status: 'decided',
      bodies: bodies.map((body) => ({ ...body, name: names.get(body.authorityId) ?? null })),
      rulesetId: result.rulesetId,
      territoryId: result.territoryId,
      citation: result.provision?.citation ?? null,
    }
  }
  if (result.reason === 'unknown_inputs')
    return { status: 'undetermined', reason: 'unknown_inputs', unknownInputs: [...result.unknownInputs] }
  return { status: 'undetermined', reason: result.reason }
}

/** Every authority id the competence tables of `rulesets` name. */
function namedAuthorities(rulesets: readonly StoredRuleset[]): string[] {
  const ids = new Set<string>()
  for (const ruleset of rulesets) {
    if (ruleset.values.body.kind !== 'table') continue
    for (const row of ruleset.values.body.payload.rows) {
      const then = row.then as { bodies?: { authorityId: string }[] } | null
      for (const body of then?.bodies ?? []) ids.add(body.authorityId)
    }
  }
  return [...ids]
}

/** Names of the authority records this organization sees, by record id. */
async function authorityNames(organizationId: string, ids: readonly string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const rows = await withTenant({ organizationId }, () =>
    getDb().execute<{ id: string; name: string }>(sql`
      SELECT r.id, a.name FROM knowledge_records r
      JOIN knowledge_authority_revisions a ON a.revision_id = r.head_revision_id
      WHERE r.type = 'authority' AND r.id = ANY(${sql.param([...ids])}::text[])`)
  )
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * The competent authority for each chain, read once for all of them. A read
 * that was truncated or found a body the evaluator cannot read decides
 * nothing: `rules_unreadable`.
 */
export async function competentAuthorities(
  organizationId: string,
  chains: readonly (readonly string[])[],
  on: string
): Promise<SiteAuthority[]> {
  if (chains.length === 0) return []
  const territoryIds = [...new Set(chains.flat())]
  const read = await readRulesetsInForce(organizationId, { purpose: 'competence', territoryIds })
  if (read.truncated || read.unreadable.length > 0)
    return chains.map(() => ({ status: 'undetermined', reason: 'rules_unreadable' }))
  const names = await authorityNames(organizationId, namedAuthorities(read.rulesets))
  return chains.map((chain) => authorityOf(read.rulesets, chain, on, names))
}
