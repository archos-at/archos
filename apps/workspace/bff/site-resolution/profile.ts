/**
 * A resolution as profile operations (ADR-0172, ADR-0158). Pure.
 *
 * Verified: the address, country, Land and municipality become confirmed facts
 * with the register as their evidence. Unverified: the typed line is an
 * assumption, as it always was; a stated country is kept as stated, and an
 * Austrian postcode still suggests the Land. Either way the previous site's
 * entries go first, so a project is never placed by an old site's facts.
 */

import type { ProfileEvidence } from '@/lib/project-profile/evidence-schema'
import type { ProjectAssumption, ProjectFact, ProjectProfilePatchOperation } from '@/lib/project-profile/types'
import { TYPED_ADDRESS_REASON, postalCodeSuggestion } from '@/lib/projects/intake-seed'
import type { RegisterSite, SiteResolution } from './wire'

/** The profile keys a site writes, and clears before it does. */
export const SITE_PROFILE_KEYS = ['site_address', 'country', 'federal_state', 'municipality', 'site_territory'] as const

function registerEvidence(site: RegisterSite, now: Date): ProfileEvidence {
  return {
    kind: 'register',
    addressId: site.addressId,
    label: site.label,
    referenceDate: site.register.referenceDate,
    resolvedAt: now.toISOString(),
  }
}

function fact(value: string, evidence: ProfileEvidence, now: Date): ProjectFact {
  return { value, confidence: 'confirmed', source: 'user_confirmed', updatedAt: now.toISOString(), evidence: [evidence] }
}

function clearSite(): ProjectProfilePatchOperation[] {
  return SITE_PROFILE_KEYS.flatMap((key) => [
    { op: 'remove' as const, path: `/facts/${key}` },
    { op: 'remove' as const, path: `/assumptions/${key}` },
  ])
}

function verifiedOperations(site: RegisterSite, now: Date): ProjectProfilePatchOperation[] {
  const evidence = registerEvidence(site, now)
  const facts: [string, string | null][] = [
    ['site_address', site.label],
    ['country', site.country.toLowerCase()],
    ['federal_state', site.state?.federalState ?? null],
    ['municipality', site.municipality.name],
    ['site_territory', site.municipality.territoryId],
  ]
  return facts.flatMap(([key, value]) => (value ? [{ op: 'add' as const, path: `/facts/${key}`, value: fact(value, evidence, now) }] : []))
}

function unverifiedOperations(resolution: Extract<SiteResolution, { status: 'unverified' }>, userId: string, now: Date): ProjectProfilePatchOperation[] {
  const typed: ProjectAssumption = {
    value: resolution.typed,
    status: 'unconfirmed',
    reason: TYPED_ADDRESS_REASON,
    source: 'onboarding_default',
    updatedAt: now.toISOString(),
    evidence: [{ kind: 'person', userId, at: now.toISOString() }],
  }
  const operations: ProjectProfilePatchOperation[] = [{ op: 'add', path: '/assumptions/site_address', value: typed }]
  const stated = resolution.statedCountry
  if (stated && stated !== 'AT') {
    const country: ProjectAssumption = { ...typed, value: stated.toLowerCase(), evidence: typed.evidence }
    operations.push({ op: 'add', path: '/assumptions/country', value: country })
    return operations
  }
  const suggested = postalCodeSuggestion(resolution.typed, now)
  if (suggested) operations.push({ op: 'add', path: '/assumptions/federal_state', value: suggested })
  return operations
}

/** The operations that set a project's site to `resolution`, the old site's entries cleared first. */
export function siteProfileOperations(resolution: SiteResolution, userId: string, now: Date): ProjectProfilePatchOperation[] {
  const set = resolution.status === 'verified' ? verifiedOperations(resolution.site, now) : unverifiedOperations(resolution, userId, now)
  return [...clearSite(), ...set]
}
