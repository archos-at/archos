import { isOfficeDefault, profileNamesSite } from '@/lib/project-profile/site'
import { namesAnotherCountry, postalPlaceOf } from '@/lib/project-profile/postal-place'
import type { SiteLeaf } from './resolve'

type Entry = { value?: unknown; source?: unknown; evidence?: unknown } | undefined
interface ProfileSiteEntries {
  facts?: Readonly<Record<string, Entry>>
  assumptions?: Readonly<Record<string, Entry>>
}

const TERRITORY_ID = /^[A-Z]{2}(?:-[A-Z0-9]{1,3}|:[a-z]{2,8}:[A-Za-z0-9]{1,20})?$/

export type SubdivisionTerritories = Readonly<Record<string, string>>

export type PlacementStep = 'fact' | 'assumption' | 'address' | 'onboarding_default' | 'office_default'

export interface SitePlacement {
  step: PlacementStep
  territoryId: string
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
  return officeAssumed && !profileNamesSite(profile) && !addressAbroad(profile) ? { step: 'office_default', territoryId: officeAssumed } : null
}

export function siteLeaves(
  profile: ProfileSiteEntries | null | undefined,
  subdivisions: SubdivisionTerritories,
  officeAssumed: string | null = null
): SiteLeaf[] {
  const placed = sitePlacement(profile, subdivisions, officeAssumed)
  if (!placed) return []
  return [{ territoryId: placed.territoryId, certainty: placed.step === 'fact' ? 'verified' : 'unverified' }]
}
