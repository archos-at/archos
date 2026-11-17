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

export function siteFacts(chain: readonly string[]): Record<string, string> {
  const [leaf, ...above] = chain
  const state = chain.find(isState)
  const country = chain.find(isCountry)
  const municipality = leaf && !isState(leaf) && !isCountry(leaf) ? leaf : undefined
  const district = municipality ? above.find((id) => id !== state && id !== country) : undefined
  return {
    ...(municipality ? { municipality } : {}),
    ...(district ? { district } : {}),
    ...(state ? { state } : {}),
    ...(country ? { country } : {}),
  }
}

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
