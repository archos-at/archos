/**
 * Whether a platform authority directive applies to a project (ADR-0165,
 * design §3.3). Pure.
 *
 * A directive applies where one of its addressees is competent: the addressee's
 * authority record names the territories it decides for (MA 37: AT-9), and the
 * project's territory must lie in one of them, by the territory records' parent
 * chain or, for ISO 3166-2, by its prefix. So an MA 37 directive never applies
 * in Graz (AT-6). Where the project's territory is unknown, or an addressee's
 * authority record cannot be read and no other addressee is competent, the
 * answer says so instead of guessing; where it is known and nobody is
 * competent, the directive is left out of the turn. An addressee that names no
 * authority record decides for the territory it names.
 */

export interface PlatformAuthority {
  id: string
  name: string
  competenceTerritoryIds: string[]
}

export interface PlatformAddressee {
  name: string
  territoryId: string
  authorityId?: string
}

export type PlatformDirectiveVerdict =
  | { verdict: 'applies'; authority: string; territoryId: string }
  | { verdict: 'excluded' }
  | { verdict: 'authority_unknown' }

/** Every territory `territoryId` lies in, itself first: its parents' chain, then its ISO 3166 country. */
export function territoryChain(territoryId: string, parents: ReadonlyMap<string, readonly string[]>): string[] {
  const chain: string[] = []
  const queue = [territoryId]
  while (queue.length > 0 && chain.length < 32) {
    const next = queue.shift() as string
    if (chain.includes(next)) continue
    chain.push(next)
    queue.push(...(parents.get(next) ?? []))
    const iso = /^([A-Z]{2})-/.exec(next)
    if (iso) queue.push(iso[1])
  }
  return chain
}

export function platformDirectiveApplies(
  addressees: readonly PlatformAddressee[],
  authorities: ReadonlyMap<string, PlatformAuthority>,
  parents: ReadonlyMap<string, readonly string[]>,
  projectTerritoryId: string | null,
): PlatformDirectiveVerdict {
  if (!projectTerritoryId || addressees.length === 0) return { verdict: 'authority_unknown' }
  const chain = territoryChain(projectTerritoryId, parents)
  let unreadable = false
  for (const addressee of addressees) {
    const authority = addressee.authorityId ? authorities.get(addressee.authorityId) : undefined
    // An authority named but not readable (rolled back, or a country the office is not entitled to)
    // decides nothing: its competence is unknown, so its own territory is no evidence.
    if (addressee.authorityId && !authority) {
      unreadable = true
      continue
    }
    const competence = authority?.competenceTerritoryIds ?? [addressee.territoryId]
    if (competence.some((territory) => chain.includes(territory))) {
      return { verdict: 'applies', authority: authority?.name ?? addressee.name, territoryId: projectTerritoryId }
    }
  }
  return unreadable ? { verdict: 'authority_unknown' } : { verdict: 'excluded' }
}
