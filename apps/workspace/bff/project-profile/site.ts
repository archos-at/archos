import { isValidCountryToken, isValidFederalStateToken } from './intake-conditions'
import type { ProjectAssumption, ProjectProfile } from './types'

export type SiteCountry = string | null

function stringValue(entry: { value: unknown } | undefined): string | null {
  return typeof entry?.value === 'string' && entry.value.trim() ? entry.value.trim().toLowerCase() : null
}

function countryOf(country: string | null, federalState: string | null): SiteCountry {
  if (country && (isValidCountryToken(country) || /^[a-z]{2}$/.test(country))) return country
  if (federalState === 'outside_austria') return 'other'
  return federalState && isValidFederalStateToken(federalState) ? 'at' : null
}

export function siteCountry(profile: Pick<ProjectProfile, 'facts' | 'assumptions'>): SiteCountry {
  const confirmed = countryOf(stringValue(profile.facts.country), stringValue(profile.facts.federal_state))
  if (confirmed) return confirmed
  return countryOf(stringValue(profile.assumptions.country), stringValue(profile.assumptions.federal_state))
}

const SITE_KEYS = ['site_territory', 'federal_state', 'country'] as const

type SiteEntries = { facts?: Readonly<Record<string, unknown>>; assumptions?: Readonly<Record<string, unknown>> }

export function profileNamesSite(profile: SiteEntries | null | undefined): boolean {
  return SITE_KEYS.some((key) => profile?.facts?.[key] !== undefined || profile?.assumptions?.[key] !== undefined)
}

export function isOfficeDefault(entry: { source?: unknown; evidence?: unknown } | undefined): boolean {
  if (entry?.source !== 'onboarding_default') return false
  return !Array.isArray(entry.evidence) || entry.evidence.length === 0
}

export const ASSUMED_SITE_REASON =
  'Standardannahme des Büros: Für dieses Projekt wurde kein Standort erfasst. Bitte bestätigen oder korrigieren.'

export function assumedSiteEntry(token: string, now: string): ProjectAssumption {
  return { value: token, status: 'unconfirmed', reason: ASSUMED_SITE_REASON, source: 'onboarding_default', updatedAt: now }
}

export function withAssumedSite<T extends Pick<ProjectProfile, 'facts' | 'assumptions'>>(
  profile: T,
  assumed: { factKey: string; token: string } | null,
  now = ''
): T {
  if (!assumed || profileNamesSite(profile)) return profile
  return { ...profile, assumptions: { ...profile.assumptions, [assumed.factKey]: assumedSiteEntry(assumed.token, now) } }
}
