import type { ProfileEvidence } from '@/lib/project-profile/evidence-schema'
import type { ProjectAssumption, ProjectFact, ProjectProfile, ProjectProfilePatchOperation } from '@/lib/project-profile/types'
import { TYPED_ADDRESS_REASON, postalCodeSuggestion } from '@/lib/projects/intake-seed'
import type { RegisterSite, SiteResolution } from './wire'

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

type SiteEntries = Pick<ProjectProfile, 'facts' | 'assumptions'>

function derivedFromAddress(entry: ProjectFact | undefined): boolean {
  return (entry?.evidence ?? []).some((evidence) => evidence.kind === 'register' || evidence.kind === 'geocoder')
}

function clearSite(): ProjectProfilePatchOperation[] {
  return SITE_PROFILE_KEYS.flatMap((key) => [
    { op: 'remove' as const, path: `/facts/${key}` },
    { op: 'remove' as const, path: `/assumptions/${key}` },
  ])
}

function clearForUnverified(current: SiteEntries): ProjectProfilePatchOperation[] {
  return SITE_PROFILE_KEYS.flatMap((key) => [
    ...(key === 'site_address' || derivedFromAddress(current.facts[key]) ? [{ op: 'remove' as const, path: `/facts/${key}` }] : []),
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
    ['site_territory', site.chain.length > 0 ? site.municipality.territoryId : null],
  ]
  return facts.flatMap(([key, value]) => (value ? [{ op: 'add' as const, path: `/facts/${key}`, value: fact(value, evidence, now) }] : []))
}

function unverifiedOperations(
  resolution: Extract<SiteResolution, { status: 'unverified' }>,
  userId: string,
  now: Date,
  kept: ReadonlySet<string>
): ProjectProfilePatchOperation[] {
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
    if (kept.has('country')) return operations
    const country: ProjectAssumption = { ...typed, value: stated.toLowerCase(), evidence: typed.evidence }
    operations.push({ op: 'add', path: '/assumptions/country', value: country })
    return operations
  }
  const suggested = kept.has('federal_state') || kept.has('country') ? null : postalCodeSuggestion(resolution.typed, now)
  if (suggested) operations.push({ op: 'add', path: '/assumptions/federal_state', value: suggested })
  return operations
}

export function siteProfileOperations(
  resolution: SiteResolution,
  userId: string,
  now: Date,
  current: SiteEntries
): ProjectProfilePatchOperation[] {
  if (resolution.status === 'verified') return [...clearSite(), ...verifiedOperations(resolution.site, now)]
  const clear = clearForUnverified(current)
  const removed = new Set(clear.filter((operation) => operation.path.startsWith('/facts/')).map((operation) => operation.path.slice('/facts/'.length)))
  const kept = new Set(SITE_PROFILE_KEYS.filter((key) => current.facts[key] !== undefined && !removed.has(key)))
  return [...clear, ...unverifiedOperations(resolution, userId, now, kept)]
}
