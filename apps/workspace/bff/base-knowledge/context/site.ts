/**
 * The site's leaf from a project's profile (design §5.5 step 1, ADR-0173,
 * ADR-0158). What is recorded always wins, in this order, and
 * {@link sitePlacement} is the one function that applies it:
 *
 *  1. `fact`: a confirmed fact: the register's municipality (`site_territory`,
 *     written by `project-site-set`, ADR-0172), then the Land, then the country.
 *     The only `verified` step.
 *  2. `assumption`: a recorded assumption in the same order (the postal-code
 *     Land of migration 0201 or of a typed address, a reading's suggestion, a
 *     typed address's country), the office default below excepted.
 *  3. `address`: the Land the stored address names by its postal code and place
 *     (`postalPlaceOf`), when no Land is recorded.
 *  4. `onboarding_default`: the office default an assumption already holds (the
 *     Land migration 0018 gave projects created before the Land question, with
 *     no evidence), where no address names one.
 *  5. `office_default`: for a profile that names no site at all (an address naming
 *     another country counts as one), the subdivision
 *     its office's home country assumes (`assumedWhenUnstated` of that country's
 *     record).
 *
 * Every step after the first places the project `unverified`. With none, there
 * is no leaf and the gate reads `site_unknown`. Pure.
 */

import { isOfficeDefault, profileNamesSite } from '@/lib/project-profile/site'
import { namesAnotherCountry, postalPlaceOf } from '@/lib/project-profile/postal-place'
import type { SiteLeaf } from './resolve'

type Entry = { value?: unknown; source?: unknown; evidence?: unknown } | undefined
interface ProfileSiteEntries {
  facts?: Readonly<Record<string, Entry>>
  assumptions?: Readonly<Record<string, Entry>>
}

/** A frozen territory id the register wrote: `AT:gkz:60101`, `AT-9`, `DE`. */
const TERRITORY_ID = /^[A-Z]{2}(?:-[A-Z0-9]{1,3}|:[a-z]{2,8}:[A-Za-z0-9]{1,20})?$/

/** The territory each subdivision token names, from the released records (`subdivisionTerritories`). */
export type SubdivisionTerritories = Readonly<Record<string, string>>

/** Which step of the precedence placed the site. */
export type PlacementStep = 'fact' | 'assumption' | 'address' | 'onboarding_default' | 'office_default'

export interface SitePlacement {
  step: PlacementStep
  territoryId: string
  /** The subdivision token the address named (step `address`), for a write that records it. */
  token?: string
}

function leafOf(entries: Readonly<Record<string, Entry>>, subdivisions: SubdivisionTerritories): string | null {
  const territory = entries.site_territory?.value
  if (typeof territory === 'string' && TERRITORY_ID.test(territory)) return territory
  const state = entries.federal_state?.value
  if (typeof state === 'string' && subdivisions[state]) return subdivisions[state]
  const country = entries.country?.value
  if (typeof country === 'string' && /^[a-z]{2}$/.test(country)) return country.toUpperCase()
  return null
}

function split(assumptions: Readonly<Record<string, Entry>>): [Record<string, Entry>, Record<string, Entry>] {
  const recorded: Record<string, Entry> = {}
  const defaults: Record<string, Entry> = {}
  for (const [key, entry] of Object.entries(assumptions)) (isOfficeDefault(entry) ? defaults : recorded)[key] = entry
  return [recorded, defaults]
}

function addressAbroad(profile: ProfileSiteEntries | null | undefined): boolean {
  const address = profile?.facts?.site_address?.value ?? profile?.assumptions?.site_address?.value
  return typeof address === 'string' && namesAnotherCountry(address)
}

function addressPlacement(profile: ProfileSiteEntries, subdivisions: SubdivisionTerritories): SitePlacement | null {
  const address = profile.facts?.site_address?.value ?? profile.assumptions?.site_address?.value
  const place = typeof address === 'string' ? postalPlaceOf(address) : null
  const territoryId = place ? subdivisions[place.federalState] : undefined
  return place && territoryId ? { step: 'address', territoryId, token: place.federalState } : null
}

/**
 * Where the profile places the site, and by which step (see the module header), or null.
 * `officeAssumed` is the home country's assumed territory (`assumedSubdivisionOf`); null assumes none.
 */
export function sitePlacement(
  profile: ProfileSiteEntries | null | undefined,
  subdivisions: SubdivisionTerritories,
  officeAssumed: string | null = null
): SitePlacement | null {
  const confirmed = leafOf(profile?.facts ?? {}, subdivisions)
  if (confirmed) return { step: 'fact', territoryId: confirmed }
  const [recorded, defaults] = split(profile?.assumptions ?? {})
  const assumed = leafOf(recorded, subdivisions)
  if (assumed) return { step: 'assumption', territoryId: assumed }
  const addressed = profile ? addressPlacement(profile, subdivisions) : null
  if (addressed) return addressed
  const defaulted = leafOf(defaults, subdivisions)
  if (defaulted) return { step: 'onboarding_default', territoryId: defaulted }
  // An address that names another country is a place recorded: the context asks rather than assume the office's
  // home. An address that names none (a street without a code) still takes the default, as it did before.
  return officeAssumed && !profileNamesSite(profile) && !addressAbroad(profile) ? { step: 'office_default', territoryId: officeAssumed } : null
}

/** The site's leaves: at most one today, from {@link sitePlacement}; only a confirmed fact is `verified`. */
export function siteLeaves(
  profile: ProfileSiteEntries | null | undefined,
  subdivisions: SubdivisionTerritories,
  officeAssumed: string | null = null
): SiteLeaf[] {
  const placed = sitePlacement(profile, subdivisions, officeAssumed)
  if (!placed) return []
  return [{ territoryId: placed.territoryId, certainty: placed.step === 'fact' ? 'verified' : 'unverified' }]
}
