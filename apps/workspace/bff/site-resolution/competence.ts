/**
 * Which authority is competent for a site: the competence rulesets in force
 * for its chain, decided by the one evaluator (ADR-0166, `decide`), and the
 * authority records they name (ADR-0165). Nothing here knows a country.
 *
 * The facts a competence table may read, all territory ids of the site's
 * chain as the territory records hold it: `municipality` (`AT:gkz:60101`),
 * `district` (a Bezirk, when recorded), `state` (`AT-6`), `country` (`AT`). A
 * municipality with no territory record has no chain: `undetermined:
 * no_territory`.
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
import { recordReadable } from '@/lib/base-knowledge/store/visibility'
import { decide, type StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import type { SiteAuthority } from './wire'

const isState = (id: string): boolean => /^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(id)
const isCountry = (id: string): boolean => /^[A-Z]{2}$/.test(id)

/**
 * The facts a competence table reads, from a chain read from the territory
 * records (leaf first): `municipality` the leaf, `state` its ISO 3166-2
 * subdivision, `country` its ISO 3166-1 code, and `district` a node between the
 * municipality and the state (a Bezirk), when the records hold one. A chain
 * whose leaf is a state or a country has no municipality.
 */
export function siteFacts(chain: readonly string[]): Record<string, string> {
  const [leaf, ...above] = chain
  const state = chain.find(isState)
  const country = chain.find(isCountry)
  // A site placed only to its Land (`AT-6`) has no municipality: its leaf is the state itself.
  const municipality = leaf && !isState(leaf) && !isCountry(leaf) ? leaf : undefined
  const district = municipality ? above.find((id) => id !== state && id !== country) : undefined
  return {
    ...(municipality ? { municipality } : {}),
    ...(district ? { district } : {}),
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
      WHERE r.type = 'authority' AND r.id = ANY(${sql.param([...ids])}::text[]) AND ${recordReadable('r', organizationId)}`)
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
  if (chains.every((chain) => chain.length === 0)) return chains.map(() => ({ status: 'undetermined', reason: 'no_territory' }))
  const territoryIds = [...new Set(chains.flat())]
  const read = await readRulesetsInForce(organizationId, { purpose: 'competence', territoryIds })
  if (read.truncated || read.unreadable.length > 0)
    return chains.map(() => ({ status: 'undetermined', reason: 'rules_unreadable' }))
  const names = await authorityNames(organizationId, namedAuthorities(read.rulesets))
  return chains.map((chain): SiteAuthority =>
    chain.length === 0 ? { status: 'undetermined', reason: 'no_territory' } : authorityOf(read.rulesets, chain, on, names)
  )
}
