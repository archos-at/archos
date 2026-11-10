/**
 * Site resolution (ADR-0172): a typed address against the official registers
 * hosted in the cell, placed in the territory tree, with the competent
 * authority. Replaces the withheld `address-search`, whose public geocoder saw
 * every keystroke; nothing here leaves the cell.
 *
 * Fail closed. `verified` needs exactly one register address. No register for
 * the stated country, no imported release, no hit, several hits: `unverified`,
 * with the reason and the register's candidates. A verified site's authority
 * is still `undetermined` until a competence ruleset covers its chain.
 */

import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import { BadRequestError, NotFoundError } from '@/lib/api/errors'
import { getProjectProfile, patchProjectProfile } from '@/lib/project-profile/profile-service'
import type { ProjectProfilePatchOperation } from '@/lib/project-profile/types'
import { competentAuthorities } from './competence'
import { houseKeysOf, narrow, outcomeOf, placeKeysOf, usablePostcode } from './match'
import { parseAddress, type ParsedAddress } from './parse'
import { streetKey } from './normalize'
import { ADDRESS_REGISTERS, STATE_NAMES, federalStateToken, registerFor } from './registers'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { territoryChain } from '@/lib/base-knowledge/platform/territories'
import { readTerritoryParents } from '@/lib/base-knowledge/platform/territories'
import { siteProfileOperations } from './profile'
import { activeReleases, findByAddressId, findByKeys, type RegisterRow } from './store'
import {
  SITE_RESOLVE_MAX_CANDIDATES,
  type ProjectSiteSetBody,
  type ProjectSiteSetResponse,
  type RegisterSite,
  type SiteResolution,
} from './wire'

type Session = Pick<AuthorizedSession, 'organizationId'>

function today(now: Date): string {
  return now.toISOString().slice(0, 10)
}

/** A register row as a site, with the chain its municipality's territory records give, without its authority. Pure. */
export function siteOf(row: RegisterRow, chain: readonly string[]): Omit<RegisterSite, 'authority'> {
  const register = ADDRESS_REGISTERS[row.release.register]
  const state = register.stateOf(row.municipalityCode)
  return {
    addressId: `${register.id}:${row.addressId}`,
    label: `${row.streetName} ${row.houseNumber}, ${row.postcode} ${row.municipalityName}`,
    country: register.country,
    state: state ? { territoryId: state, name: STATE_NAMES[state] ?? state, federalState: federalStateToken(state) } : null,
    municipality: { territoryId: register.municipalityTerritory(row.municipalityCode), name: row.municipalityName, code: row.municipalityCode },
    locality: row.localityName,
    postcode: row.postcode,
    chain: [...chain],
    register: { id: register.id, referenceDate: row.release.referenceDate, attribution: row.release.attribution },
  }
}

/**
 * The chain of a municipality's territory, read from the platform's territory
 * records (ADR-0165), so a Bezirk between it and its Land is kept; empty when
 * no record holds it. Never built from the code alone.
 */
async function recordedChains(session: Session, territoryIds: readonly string[]): Promise<Map<string, string[]>> {
  const chains = new Map<string, string[]>()
  await withTenant({ organizationId: session.organizationId }, async () => {
    for (const territoryId of new Set(territoryIds)) {
      const parents = await readTerritoryParents(getDb(), territoryId)
      chains.set(territoryId, parents.has(territoryId) ? territoryChain(territoryId, parents) : [])
    }
  })
  return chains
}

async function withAuthorities(session: Session, rows: readonly RegisterRow[], now: Date): Promise<RegisterSite[]> {
  const shown = rows.slice(0, SITE_RESOLVE_MAX_CANDIDATES)
  const territoryOf = (row: RegisterRow) => ADDRESS_REGISTERS[row.release.register].municipalityTerritory(row.municipalityCode)
  const chains = await recordedChains(session, shown.map(territoryOf))
  const sites = shown.map((row) => siteOf(row, chains.get(territoryOf(row)) ?? []))
  const authorities = await competentAuthorities(session.organizationId, sites.map((site) => site.chain), today(now))
  return sites.map((site, index) => ({ ...site, authority: authorities[index] }))
}

/** The registers a parsed line is looked up in: its stated country's, else every one the cell hosts. */
function registersFor(parsed: ParsedAddress): string[] {
  if (!parsed.statedCountry) return Object.keys(ADDRESS_REGISTERS)
  const register = registerFor(parsed.statedCountry)
  return register ? [register.id] : []
}

/** Resolve a typed address. Reads only. */
export async function resolveSite(session: Session, typed: string, now = new Date()): Promise<SiteResolution> {
  const parsed = parseAddress(typed)
  const unverified = (reason: Extract<SiteResolution, { status: 'unverified' }>['reason'], candidates: RegisterSite[] = []): SiteResolution => ({
    status: 'unverified',
    typed,
    reason,
    statedCountry: parsed?.statedCountry ?? null,
    candidates,
  })
  if (!parsed) return unverified('incomplete')
  const releases = await activeReleases(session.organizationId, registersFor(parsed))
  if (releases.length === 0) return unverified('no_register')
  const narrowed: RegisterRow[] = []
  let conflict = false
  let searched = 0
  for (const release of releases) {
    const register = ADDRESS_REGISTERS[release.register]
    const postcode = usablePostcode(parsed, register.postcodeShape)
    // A postcode of another country's shape is evidence of that country (A1), unless the register lists it.
    if (parsed.postcode && !postcode && !register.crossBorderPostcodes.test(parsed.postcode)) continue
    searched += 1
    const found = await findByKeys(session.organizationId, {
      registers: [register.id],
      streetKey: streetKey(parsed.street),
      houseKeys: houseKeysOf(parsed),
      postcode,
      placeKeys: !postcode && parsed.place ? placeKeysOf(parsed.place) : null,
    })
    const result = narrow(parsed, found, register.postcodeShape)
    narrowed.push(...result.rows)
    conflict ||= result.conflict
  }
  if (searched === 0) return unverified('no_register')
  const outcome = outcomeOf(narrowed, conflict)
  // A street and number with no place place nothing, even when the register holds one such address:
  // the line could be in a country this cell has no register for (invariant A1); a four-digit postcode
  // does not say which (Switzerland and Liechtenstein have them). Its candidates are offered.
  if (!parsed.place)
    return unverified(outcome.status === 'one' ? 'incomplete' : outcome.reason, await withAuthorities(session, outcome.status === 'one' ? [outcome.row] : outcome.rows, now))
  if (outcome.status === 'one') {
    const [site] = await withAuthorities(session, [outcome.row], now)
    return { status: 'verified', typed, site }
  }
  return unverified(outcome.reason, await withAuthorities(session, outcome.rows, now))
}

/** A register address by the id `resolveSite` gave, or null when the active release holds none. */
async function siteById(session: Session, addressId: string, now: Date): Promise<RegisterSite | null> {
  const separator = addressId.indexOf(':')
  const register = ADDRESS_REGISTERS[addressId.slice(0, separator)]
  if (!register) return null
  const row = await findByAddressId(session.organizationId, register.id, addressId.slice(separator + 1))
  if (!row) return null
  const [site] = await withAuthorities(session, [row], now)
  return site
}

/**
 * Set a project's site from a register address or a typed line, through the
 * profile's one door (`patchProjectProfile`, project:edit). A register address
 * becomes confirmed facts with the register as evidence; anything else is kept
 * as an unverified assumption, as a typed address always was (ADR-0158).
 */
export async function setProjectSite(
  session: AuthorizedSession,
  projectId: string,
  body: ProjectSiteSetBody,
  now = new Date()
): Promise<ProjectSiteSetResponse> {
  if (Boolean(body.addressId) === Boolean(body.typed)) throw new BadRequestError('Give exactly one of addressId and typed.')
  let resolution: SiteResolution
  if (body.addressId) {
    const site = await siteById(session, body.addressId, now)
    if (!site) throw new NotFoundError('No address with that id in the register this cell holds.')
    resolution = { status: 'verified', typed: site.label, site }
  } else {
    resolution = await resolveSite(session, body.typed ?? '', now)
  }
  const { profile } = await getProjectProfile(session, projectId)
  const operations: ProjectProfilePatchOperation[] = siteProfileOperations(resolution, session.userId, now, profile)
  const patched = await patchProjectProfile(session, projectId, operations, undefined, { registerEvidence: true })
  return { resolution, profileVersion: patched.profileVersion }
}
