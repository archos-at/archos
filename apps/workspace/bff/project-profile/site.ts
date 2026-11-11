/**
 * Where the project is, as far as its profile says (design
 * `docs/design/international/design.md` 3.1, invariant A1). Since ADR-0175 this
 * is the one reader: the agent takes the site from the knowledge context the BFF
 * sends, and has no twin of its own.
 *
 * A project is placed by its own `country` line, else by a Land token, the
 * confirmed facts first and then the assumptions (a typed address, a reading's
 * suggestion), which place it as unverified. Nothing places it by default:
 * not the office's seat, not Austria. Pure and client-safe.
 */

import { isValidCountryToken, isValidFederalStateToken } from './intake-conditions'
import type { ProjectProfile } from './types'

/** `null`: nothing places the project (`site_unknown`). `other`: a country the intake does not name. */
export type SiteCountry = string | null

function stringValue(entry: { value: unknown } | undefined): string | null {
  return typeof entry?.value === 'string' && entry.value.trim() ? entry.value.trim().toLowerCase() : null
}

/**
 * The site one section places, or null. A value the intake does not offer (a
 * stray `federal_state=foo`) places nothing: the page and the turn read one
 * profile the same way.
 */
function countryOf(country: string | null, federalState: string | null): SiteCountry {
  if (country && (isValidCountryToken(country) || /^[a-z]{2}$/.test(country))) return country
  if (federalState === 'outside_austria') return 'other'
  return federalState && isValidFederalStateToken(federalState) ? 'at' : null
}

/** The project's country: `at`, another ISO-2 code, `other`, or `null` when nothing places it. */
export function siteCountry(profile: Pick<ProjectProfile, 'facts' | 'assumptions'>): SiteCountry {
  const confirmed = countryOf(stringValue(profile.facts.country), stringValue(profile.facts.federal_state))
  if (confirmed) return confirmed
  return countryOf(stringValue(profile.assumptions.country), stringValue(profile.assumptions.federal_state))
}
