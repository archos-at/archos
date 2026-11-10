/**
 * The building class per building, as the review shows it and as a reading
 * writes it (ADR-0111, „The Gebäudeklasse derivation"). Pure.
 *
 * The inputs are read by the reader `computeNeeds` weighs decisive needs
 * with (`buildingClassInputsFor`): through the wizard's answers, facts first
 * and suggestions under them, so the wizard's legacy bridges reach the
 * derivation and the class the review shows is the class the needs were
 * computed against. Each input says whether it is only suggested.
 *
 * Writing: when every input that matters has a value, the class is written as
 * the suggestion `building_class@bldgN` with `derivation` evidence. It is never
 * written over a confirmed class: a different one becomes an alternative on
 * the fact, as a document's would. A Hochhaus, or a building that is no
 * building, gets nothing.
 */

import { answersFromProfile } from '@/lib/project-profile/intake-profile'
import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import type { DerivationEvidence, DerivationInput, ProfileAlternative } from '@/lib/project-profile/evidence-schema'
import type { ProjectProfile } from '@/lib/project-profile/types'
import { deriveBuildingClass } from './derivations'
import { buildingClassInputsFor } from './needs'
import {
  BUILDING_CLASS_RULE,
  buildingClassificationOf,
  classificationInputs,
  setupScopeOf,
  type BuildingClassification,
  type SetupScopeOptions,
} from './setup-scope'
import { sameProfileValue, suggestedAssumption, withAlternative } from './profile-edits'
import type { DerivationView } from './types'

/** The profile key the class of one building is stored under. */
export const buildingClassKey = (buildingId: string): string => `building_class@${buildingId}`

/** Whether `key` holds a class, of a building or flat: derived here, never recorded by a reading. */
export const isBuildingClassKey = (key: string): boolean => key.split('@')[0] === 'building_class'

/** The reason a derived suggestion carries, beside its evidence. Read by a person and by the agent's prompt view. */
export const derivedReason = (citation: string): string => `Abgeleitet: ${citation}`

/**
 * The building classification the project's site selects (`setup-scope.ts`),
 * or null: a project nothing places, or one in a country with no
 * classification record, has no class to derive (ADR-0158, ADR-0169).
 */
export function classificationFor(
  profile: ProjectProfile,
  options: SetupScopeOptions = {}
): BuildingClassification | null {
  return buildingClassificationOf(setupScopeOf(profile, options))
}

/** The buildings the profile describes, in order (`bldg1` when it names none). */
export function buildingIdsOf(profile: ProjectProfile, definition: ProjectIntakeDefinition): string[] {
  return answersFromProfile(profile, definition).buildings.map((building) => building.id)
}

/** The class of one building under `classification`, and what it read. */
export function deriveForBuilding(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  buildingId: string,
  classification: BuildingClassification
): DerivationView {
  const known = buildingClassInputsFor(profile, definition, buildingId, classificationInputs(classification))
  const inputs: DerivationInput[] = []
  for (const [input, value] of Object.entries(known)) {
    if (value === undefined) continue
    const key = `${input}@${buildingId}`
    inputs.push({ key, value, suggested: !(key in profile.facts) })
  }
  const result = deriveBuildingClass(classification, known)
  return {
    buildingId: buildingId,
    rule: BUILDING_CLASS_RULE,
    citation: classification.derivation.citation,
    value: result.value,
    highRise: result.hochhaus,
    inputs,
    missing: [...result.missing],
  }
}

/**
 * Every building's class. None unless the site selects a classification: the
 * OIB's Gebäudeklasse binds in Austria only, another country classifies by its
 * own record or not at all, and an unplaced project is asked for its site
 * first (ADR-0158).
 */
export function deriveAll(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  options: SetupScopeOptions = {}
): DerivationView[] {
  const classification = classificationFor(profile, options)
  if (!classification) return []
  return buildingIdsOf(profile, definition).map((buildingId) =>
    deriveForBuilding(profile, definition, buildingId, classification)
  )
}

/** The profile keys that place a project: a change moves which classification applies, if any. */
const SITE_KEYS: readonly string[] = ['country', 'federal_state']

/**
 * The buildings whose class may have moved when these keys changed: a
 * project-wide input moves every one. A change to where the project is moves
 * every one too, since the site selects the classification itself.
 */
export function buildingsTouchedBy(
  keys: Iterable<string>,
  allBuildings: readonly string[],
  inputs: readonly string[]
): string[] {
  const touched = new Set<string>()
  for (const key of keys) {
    const [base, scope] = key.split('@')
    if (SITE_KEYS.includes(base)) return [...allBuildings]
    if (!inputs.includes(base)) continue
    if (!scope) return [...allBuildings]
    if (allBuildings.includes(scope)) touched.add(scope)
  }
  return allBuildings.filter((buildingId) => touched.has(buildingId))
}

function derivationEvidence(view: DerivationView): DerivationEvidence {
  return { kind: 'derivation', rule: view.rule, citation: view.citation, inputs: view.inputs }
}

const isDerived = (alternative: ProfileAlternative) => alternative.evidence.some((entry) => entry.kind === 'derivation')

function withoutDerivedSuggestion(profile: ProjectProfile, key: string): { profile: ProjectProfile; changed: boolean } {
  const current = profile.assumptions[key]
  const derived = current?.source === 'agent_suggested' && (current.evidence ?? []).some((entry) => entry.kind === 'derivation')
  if (!derived) return { profile, changed: false }
  const assumptions = { ...profile.assumptions }
  delete assumptions[key]
  return { profile: { ...profile, assumptions }, changed: true }
}

/**
 * The profile with the class of `buildingId` written as the derivation says,
 * and whether it changed. While the class is unknown, a class an earlier
 * derivation suggested goes with the inputs it was derived from (a reading
 * withdrew one); a confirmed class, or one a document stated, stays.
 */
export function withDerivedClass(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  buildingId: string,
  now: string,
  options: SetupScopeOptions = {}
): { profile: ProjectProfile; changed: boolean } {
  const key = buildingClassKey(buildingId)
  // A class binds only where the site's own record defines it, and an unplaced project is in no country yet: none is written.
  const classification = classificationFor(profile, options)
  if (!classification) return withoutDerivedSuggestion(profile, key)
  const view = deriveForBuilding(profile, definition, buildingId, classification)
  if (view.value === null) return withoutDerivedSuggestion(profile, key)
  const evidence = derivationEvidence(view)

  const fact = profile.facts[key]
  if (fact) {
    if (sameProfileValue(fact.value, view.value)) return { profile, changed: false }
    // A derived alternative replaces the one an earlier derivation left: the inputs moved, the class with them.
    const alternatives = withAlternative((fact.alternatives ?? []).filter((entry) => !isDerived(entry)), view.value, evidence, now)
    return { profile: { ...profile, facts: { ...profile.facts, [key]: { ...fact, alternatives } } }, changed: true }
  }

  const current = profile.assumptions[key]
  if (current && sameProfileValue(current.value, view.value) && JSON.stringify(current.evidence) === JSON.stringify([evidence])) {
    return { profile, changed: false }
  }
  const next = {
    ...suggestedAssumption(view.value, derivedReason(view.citation), [evidence], now),
    ...(current?.alternatives?.length ? { alternatives: current.alternatives } : {}),
  }
  return { profile: { ...profile, assumptions: { ...profile.assumptions, [key]: next } }, changed: true }
}
