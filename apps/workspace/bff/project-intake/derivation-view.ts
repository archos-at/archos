import { gateNamesLaw } from '@/lib/base-knowledge/wire/project-law'
import type { GateState } from '@/lib/base-knowledge/wire/vocab'
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

export const buildingClassKey = (buildingId: string): string => `building_class@${buildingId}`

export const isBuildingClassKey = (key: string): boolean => key.split('@')[0] === 'building_class'

export const derivedReason = (citation: string): string => `Abgeleitet: ${citation}`

export function classificationFor(
  profile: ProjectProfile,
  options: SetupScopeOptions
): BuildingClassification | null {
  if (options.lawWithheld) return null
  return buildingClassificationOf(setupScopeOf(profile, options))
}

export function withoutDerivedClasses(profile: ProjectProfile, definition: ProjectIntakeDefinition): ProjectProfile {
  let current = profile
  for (const buildingId of buildingIdsOf(profile, definition)) {
    const key = buildingClassKey(buildingId)
    current = withoutDerivedSuggestion(current, key).profile
    const fact = current.facts[key]
    if (fact?.alternatives?.some(isDerived)) {
      const alternatives = fact.alternatives.filter((entry) => !isDerived(entry))
      current = { ...current, facts: { ...current.facts, [key]: { ...fact, alternatives } } }
    }
  }
  return current
}

export function profileAsTheLawShows(profile: ProjectProfile, definition: ProjectIntakeDefinition, gate: GateState | null): ProjectProfile {
  return gate === null || gateNamesLaw(gate) ? profile : withoutDerivedClasses(profile, definition)
}

export function buildingIdsOf(profile: ProjectProfile, definition: ProjectIntakeDefinition): string[] {
  return answersFromProfile(profile, definition).buildings.map((building) => building.id)
}

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

export function deriveAll(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  options: SetupScopeOptions
): DerivationView[] {
  const classification = classificationFor(profile, options)
  if (!classification) return []
  return buildingIdsOf(profile, definition).map((buildingId) =>
    deriveForBuilding(profile, definition, buildingId, classification)
  )
}

export function buildingsTouchedBy(
  keys: Iterable<string>,
  allBuildings: readonly string[],
  inputs: readonly string[]
): string[] {
  const touched = new Set<string>()
  for (const key of keys) {
    const [base, scope] = key.split('@')
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

export function withDerivedClass(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  buildingId: string,
  now: string,
  options: SetupScopeOptions
): { profile: ProjectProfile; changed: boolean } {
  const key = buildingClassKey(buildingId)
  const classification = classificationFor(profile, options)
  if (!classification) return withoutDerivedSuggestion(profile, key)
  const view = deriveForBuilding(profile, definition, buildingId, classification)
  if (view.value === null) return withoutDerivedSuggestion(profile, key)
  const evidence = derivationEvidence(view)

  const fact = profile.facts[key]
  if (fact) {
    if (sameProfileValue(fact.value, view.value)) return { profile, changed: false }
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
