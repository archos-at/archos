/**
 * Where the project is, as far as its profile says: the TypeScript twin of
 * `agent.common.country_profile.resolve_site` (design
 * `docs/design/international/design.md` 3.1, invariant A1).
 *
 * A project is placed by its own `country` line, else by a Land token, the
 * confirmed facts first and then the assumptions (a typed address, a reading's
 * suggestion), which place it as unverified. Nothing places it by default:
 * not the office's seat, not Austria. Pure and client-safe.
 */

import type { ProjectProfile } from './types'

/** `null`: nothing places the project (`site_unknown`). `other`: a country the intake does not name. */
export type SiteCountry = string | null

function stringValue(entry: { value: unknown } | undefined): string | null {
  return typeof entry?.value === 'string' && entry.value.trim() ? entry.value.trim().toLowerCase() : null
}

function countryOf(country: string | null, federalState: string | null): SiteCountry {
  if (country) return country
  if (federalState === 'outside_austria') return 'other'
  return federalState ? 'at' : null
}

/** The project's country: `at`, another ISO-2 code, `other`, or `null` when nothing places it. */
export function siteCountry(profile: Pick<ProjectProfile, 'facts' | 'assumptions'>): SiteCountry {
  const confirmed = countryOf(stringValue(profile.facts.country), stringValue(profile.facts.federal_state))
  if (confirmed) return confirmed
  return countryOf(stringValue(profile.assumptions.country), stringValue(profile.assumptions.federal_state))
}

/** Whether the profile places the project outside Austria. A project nothing places is not outside: it is unknown. */
export function placedOutsideAustria(profile: Pick<ProjectProfile, 'facts' | 'assumptions'>): boolean {
  const country = siteCountry(profile)
  return country !== null && country !== 'at'
}
