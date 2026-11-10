/**
 * What creating a project with „Piloti richtet ein" writes beyond the project:
 * the `project_intakes` row and the profile entries the address already decides
 * (ADR-0111, `docs/design/agentic-project-intake.md`).
 *
 * The address search's hit is evidence, not a guess: a person chose it from the
 * geocoder's list, so `site_address`, `country` and `federal_state` go onto the
 * profile as confirmed facts, the first one carrying the geocoder as its source.
 * An address typed and not chosen from a list (no geocoder configured, or no
 * hit taken) is the person's own line, and no register confirmed it: it goes
 * in as an unconfirmed assumption (`site_address`, the person as its evidence),
 * never as a confirmed fact (design `docs/design/international/design.md`,
 * invariant A1). Its Postleitzahl and place, when they name one Austrian Land
 * (`postal-place.ts`, a table shipped with the code), suggest the Bundesland:
 * an unconfirmed assumption carrying the derivation as its evidence, which
 * places the project in Austria as unverified until the person confirms it.
 * Otherwise the Bundesland is the reading's to find or the review's to ask. A
 * Bundesland chosen by hand (the create form's picker, an API caller) is a fact
 * the person stated.
 *
 * `country` is written as `at` only for an Austrian site: a geocoder hit (the
 * adapter keeps Austrian hits only), an Austrian Land, or Austria chosen by
 * hand. A country chosen by hand other than Austria is written as stated, with
 * `federal_state=outside_austria`, and outranks an Austrian Land in the same
 * body. A project marked `outside_austria` with no country gets none: which
 * country it is, the intake asks.
 *
 * The profile and the intake row are one write (`seedProjectProfile`'s
 * `inTransaction`), so a project never has facts without its intake or the
 * other way round. The write skips the access check for the reason
 * `createProject` closes a new project through the repository: the creator's
 * FGA grant may not have propagated yet.
 */

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
import type { ProjectAssumption, ProjectFact, ProjectProfile } from '@/lib/project-profile/types'
import { inProjectTransaction } from './repository'

export interface IntakeSeedInput {
  description?: string | undefined
  location?: GeocodeResult | undefined
  /** The address as the person typed it, when no search hit was chosen. */
  address?: string | undefined
  /** An A2_land token chosen by hand, when no address was searched. */
  federalState?: string | undefined
  /** An A2_country token chosen by hand: `at`, `de`, `ch` or `other`. */
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

/** Why a typed address waits for confirmation. Read by a person in the brief and by the agent's prompt view. */
export const TYPED_ADDRESS_REASON = 'Adresse eingetippt, von keinem Register bestätigt'

/** Why a Land read from the Postleitzahl waits for confirmation. */
export const POSTAL_CODE_REASON = 'Aus der Postleitzahl der eingetippten Adresse abgeleitet'

/** The Bundesland a typed address suggests, as an assumption with its derivation. Null when its PLZ names none. */
function postalCodeSuggestion(typed: string, now: Date): ProjectAssumption | null {
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

/** The profile entries a new project starts with. */
export interface IntakeSeed {
  facts: Record<string, ProjectFact>
  assumptions: Record<string, ProjectAssumption>
}

/**
 * The entries a location, a typed address or a hand-chosen Bundesland puts on
 * a new profile. Empty when none was given. Pure.
 */
export function intakeSeed(
  input: Pick<IntakeSeedInput, 'location' | 'address' | 'federalState' | 'country'>,
  now: Date,
  userId: string
): IntakeSeed {
  const { location } = input
  const typed = input.address?.trim()
  // A country other than Austria, chosen by hand, outranks any Austrian Land the same body names.
  const abroad = !location && input.country !== undefined && input.country !== 'at'
  const federalState = abroad ? 'outside_austria' : (location?.federalState ?? input.federalState ?? null)
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
  const austrianState = federalState !== null && federalState !== 'outside_austria'
  if (abroad && input.country) facts.country = fact(input.country, now)
  else if (location || austrianState || input.country === 'at') facts.country = fact('at', now)
  if (federalState) facts.federal_state = fact(federalState, now)
  return { facts, assumptions }
}

/** The intake row of a project being created: waiting for its documents. */
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

/** Write the intake row, and the profile facts with it when there are any. Throws on failure; the caller rolls the project back. */
export async function startProjectIntake(
  session: AuthorizedSession,
  project: Project,
  input: IntakeSeedInput,
  now: Date
): Promise<void> {
  const row = intakeRowFor(session, project.id, input)
  const seeded = intakeSeed(input, now, session.userId)
  const insertRow = async (tx: Parameters<typeof insertProjectIntake>[0]): Promise<void> => {
    await insertProjectIntake(tx, row)
  }
  if (Object.keys(seeded.facts).length === 0 && Object.keys(seeded.assumptions).length === 0) {
    await inProjectTransaction(session.organizationId, insertRow)
    return
  }
  const base: ProjectProfile = salvageProjectProfile(project.profile).profile ?? emptyProjectProfile()
  const profile = pruneResolvedAssumptions({
    ...base,
    facts: { ...base.facts, ...seeded.facts },
    assumptions: { ...base.assumptions, ...seeded.assumptions },
  })
  await seedProjectProfile(project, profile, insertRow)
}
