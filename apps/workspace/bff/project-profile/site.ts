/**
 * Where the project is, as far as its profile says (design
 * `docs/design/international/design.md` 3.1, invariant A1). Since ADR-0175 this
 * is the one reader: the agent takes the site from the knowledge context the BFF
 * sends, and has no twin of its own.
 *
 * A project is placed by its own `country` line, else by a Land token, the
 * confirmed facts first and then the assumptions (a typed address, a reading's
 * suggestion), which place it as unverified. The office's seat never decides
 * the country of a project that names one; a profile with no place recorded at
 * all is assumed to be in the subdivision its home country's record names
 * (`withAssumedSite`, ADR-0158), as an unverified assumption a person confirms
 * or corrects. The full order the knowledge context places a site by is
 * `sitePlacement` (`bff/base-knowledge/context/site.ts`). Pure and client-safe.
 */

import { isValidCountryToken, isValidFederalStateToken } from './intake-conditions'
import type { ProjectAssumption, ProjectProfile } from './types'

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

/** The keys that place a site: a profile holding none of them, as a fact or an assumption, names no site. */
const SITE_KEYS = ['site_territory', 'federal_state', 'country'] as const

type SiteEntries = { facts?: Readonly<Record<string, unknown>>; assumptions?: Readonly<Record<string, unknown>> }

/** Whether the profile names a site at all: a country, a subdivision (the outside token included) or a register territory. */
export function profileNamesSite(profile: SiteEntries | null | undefined): boolean {
  return SITE_KEYS.some((key) => profile?.facts?.[key] !== undefined || profile?.assumptions?.[key] !== undefined)
}

/**
 * Whether an assumption is an office default rather than something recorded about the project: written by
 * the onboarding (`onboarding_default`) with no evidence, as migration 0018's Land and `assumedSiteEntry`
 * are. A postal-code Land carries its derivation and a typed address's country the person, so neither is one.
 */
export function isOfficeDefault(entry: { source?: unknown; evidence?: unknown } | undefined): boolean {
  if (entry?.source !== 'onboarding_default') return false
  return !Array.isArray(entry.evidence) || entry.evidence.length === 0
}

/** The reason the assumed site carries, as a person reads it beside the value to confirm or correct. */
export const ASSUMED_SITE_REASON =
  'Standardannahme des Büros: Für dieses Projekt wurde kein Standort erfasst. Bitte bestätigen oder korrigieren.'

/** The assumption a profile that names no site is given: the subdivision its office's home country assumes. */
export function assumedSiteEntry(token: string, now: string): ProjectAssumption {
  return { value: token, status: 'unconfirmed', reason: ASSUMED_SITE_REASON, source: 'onboarding_default', updatedAt: now }
}

/**
 * The profile with the assumed site under `assumed.factKey` when it names no site, else the profile itself
 * (the same object). `assumed` is the home country's `assumedWhenUnstated` subdivision (`assumedSubdivisionOf`);
 * null assumes nothing.
 */
export function withAssumedSite<T extends Pick<ProjectProfile, 'facts' | 'assumptions'>>(
  profile: T,
  assumed: { factKey: string; token: string } | null,
  now = ''
): T {
  if (!assumed || profileNamesSite(profile)) return profile
  return { ...profile, assumptions: { ...profile.assumptions, [assumed.factKey]: assumedSiteEntry(assumed.token, now) } }
}
