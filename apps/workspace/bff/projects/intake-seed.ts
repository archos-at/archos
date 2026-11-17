import 'server-only'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { NewProjectIntakeRow } from '@/lib/db/schema/project-intakes'
import type { Project } from '@/lib/db/schema/projects'
import type { GeocodeResult } from '@/lib/geocoding/types'
import { insertProjectIntake } from '@/lib/project-intake/repository'
import type { ClosingIntent } from '@/lib/project-intake/types'
import { emptyProjectProfile, pruneResolvedAssumptions } from '@/lib/project-profile/patch-engine'
import { postalPlaceOf } from '@/lib/project-profile/postal-place'
import { seedProjectProfile } from '@/lib/project-profile/profile-service'
import { salvageProjectProfile } from '@/lib/project-profile/salvage'
import { SITE_SUBDIVISIONS } from '@/lib/project-profile/intake-stages/project-basis'
import type { ProjectAssumption, ProjectFact, ProjectProfile } from '@/lib/project-profile/types'
import { inProjectTransaction, type ProjectProfileState } from './repository'

export interface IntakeSeedInput {
  description?: string | undefined
  location?: GeocodeResult | undefined
  address?: string | undefined
  federalState?: string | undefined
  country?: string | undefined
  closing?: ClosingIntent | undefined
}

function fact(value: string, now: Date, evidence?: ProjectFact['evidence']): ProjectFact {
  return {
    value,
    confidence: 'confirmed',
    source: 'onboarding',
    updatedAt: now.toISOString(),
    ...(evidence ? { evidence } : {}),
  }
}

export const TYPED_ADDRESS_REASON = 'Adresse eingetippt, von keinem Register bestätigt'

export const POSTAL_CODE_REASON = 'Aus der Postleitzahl der eingetippten Adresse abgeleitet'

export function postalCodeSuggestion(typed: string, now: Date): ProjectAssumption | null {
  const place = postalPlaceOf(typed)
  if (!place) return null
  return {
    value: place.federalState,
    status: 'unconfirmed',
    reason: POSTAL_CODE_REASON,
    source: 'onboarding_default',
    updatedAt: now.toISOString(),
    evidence: [
      {
        kind: 'derivation',
        rule: 'postal_code',
        citation: `PLZ ${place.code} (GeoNames, CC BY 4.0)`,
        inputs: [{ key: 'site_address', value: typed, suggested: true }],
      },
    ],
  }
}

export interface IntakeSeed {
  facts: Record<string, ProjectFact>
  assumptions: Record<string, ProjectAssumption>
}

export function intakeSeed(
  input: Pick<IntakeSeedInput, 'location' | 'address' | 'federalState' | 'country'>,
  now: Date,
  userId: string
): IntakeSeed {
  const { location } = input
  const typed = input.address?.trim()
  const { country: subdivided, outside } = SITE_SUBDIVISIONS
  const abroad = !location && input.country !== undefined && input.country !== subdivided
  const federalState = abroad ? outside : (location?.federalState ?? input.federalState ?? null)
  const facts: Record<string, ProjectFact> = {}
  const assumptions: Record<string, ProjectAssumption> = {}
  if (location) {
    facts.site_address = fact(location.label, now, [
      { kind: 'geocoder', provider: 'photon', label: location.label, resolvedAt: now.toISOString() },
    ])
  } else if (typed) {
    assumptions.site_address = {
      value: typed,
      status: 'unconfirmed',
      reason: TYPED_ADDRESS_REASON,
      source: 'onboarding_default',
      updatedAt: now.toISOString(),
      evidence: [{ kind: 'person', userId, at: now.toISOString() }],
    }
    const suggested = federalState ? null : postalCodeSuggestion(typed, now)
    if (suggested) assumptions.federal_state = suggested
  }
  const inSubdivision = federalState !== null && federalState !== outside
  if (abroad && input.country) facts.country = fact(input.country, now)
  else if (location || inSubdivision || input.country === subdivided) facts.country = fact(subdivided, now)
  if (federalState) facts.federal_state = fact(federalState, now)
  return { facts, assumptions }
}

export function intakeRowFor(
  session: Pick<AuthorizedSession, 'organizationId' | 'userId'>,
  projectId: string,
  input: IntakeSeedInput
): NewProjectIntakeRow {
  return {
    organizationId: session.organizationId,
    projectId,
    createdBy: session.userId,
    mode: input.closing ? 'closing' : 'active',
    description: input.description?.trim() || null,
    location: input.location ?? null,
    closing: input.closing ?? null,
    status: 'waiting',
  }
}

function seededProfile(project: Project, seeded: IntakeSeed): ProjectProfile | null {
  if (Object.keys(seeded.facts).length === 0 && Object.keys(seeded.assumptions).length === 0) return null
  const base: ProjectProfile = salvageProjectProfile(project.profile).profile ?? emptyProjectProfile()
  return pruneResolvedAssumptions({
    ...base,
    facts: { ...base.facts, ...seeded.facts },
    assumptions: { ...base.assumptions, ...seeded.assumptions },
  })
}

export async function startProjectIntake(
  session: AuthorizedSession,
  project: Project,
  input: IntakeSeedInput,
  now: Date
): Promise<ProjectProfileState | null> {
  const row = intakeRowFor(session, project.id, input)
  const insertRow = async (tx: Parameters<typeof insertProjectIntake>[0]): Promise<void> => {
    await insertProjectIntake(tx, row)
  }
  const profile = seededProfile(project, intakeSeed(input, now, session.userId))
  if (!profile) {
    await inProjectTransaction(session.organizationId, insertRow)
    return null
  }
  return seedProjectProfile(project, profile, insertRow)
}

export async function seedProjectSite(
  session: Pick<AuthorizedSession, 'userId'>,
  project: Project,
  input: Pick<IntakeSeedInput, 'location' | 'address' | 'federalState' | 'country'>,
  now: Date
): Promise<ProjectProfileState | null> {
  const profile = seededProfile(project, intakeSeed(input, now, session.userId))
  return profile ? seedProjectProfile(project, profile) : null
}
