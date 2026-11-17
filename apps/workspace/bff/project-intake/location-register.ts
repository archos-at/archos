import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import type { FactSource } from '@/lib/base-knowledge/wire/setup-facts'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import { siteCountry } from '@/lib/project-profile/site'
import { factDefinitionsOf, factSourcesOf, setupScopeOf } from './setup-scope'
import type { DocumentRequest, IntakeMode, LocationRegisterView, Need } from './types'
import { LOCATION_DETERMINANTS } from './types'

export interface LocationRegisterInput {
  profile: ProjectProfile
  location: { federalState: string | null; municipality: string | null } | null
  mode: IntakeMode
  needs: readonly Need[]
  records: readonly StoredRuleset[]
}

interface Situation {
  subdivision: { token: string; territoryId: string } | null
  municipality: string | null
  projectTypes: readonly string[] | null
  uses: readonly string[] | null
  existing: readonly string[]
}

function valueOf(profile: ProjectProfile, key: string): ProjectPrimitiveValue | undefined {
  return profile.facts[key]?.value ?? profile.assumptions[key]?.value
}

function scopedValues(profile: ProjectProfile, baseKey: string): Array<{ key: string; value: ProjectPrimitiveValue }> {
  const keys = new Set([...Object.keys(profile.facts), ...Object.keys(profile.assumptions)])
  return [...keys]
    .filter((key) => key.split('@')[0] === baseKey)
    .map((key) => ({ key, value: valueOf(profile, key) }))
    .filter((entry): entry is { key: string; value: ProjectPrimitiveValue } => entry.value !== undefined)
}

const asList = (value: ProjectPrimitiveValue | undefined): string[] | null => {
  if (Array.isArray(value)) return value.length > 0 ? value : null
  return typeof value === 'string' && value ? [value] : null
}

function situationOf(
  input: LocationRegisterInput,
  subdivision: { token: string; territoryId: string; municipality?: string } | null
): Situation {
  const { profile, location } = input
  const uses = scopedValues(profile, 'uses').flatMap(({ value }) => asList(value) ?? [])
  return {
    subdivision,
    municipality: location?.municipality ?? subdivision?.municipality ?? null,
    projectTypes: asList(valueOf(profile, 'work_type')),
    uses: uses.length > 0 ? [...new Set(uses)] : null,
    existing: scopedValues(profile, 'construction_status')
      .filter(({ key, value }) => value === 'existing' && key.includes('@'))
      .map(({ key }) => key.split('@')[1]),
  }
}

const meets = (known: readonly string[] | null, wanted: readonly string[] | undefined): boolean =>
  !wanted || known === null || known.some((value) => wanted.includes(value))

export function entryApplies(entry: FactSource, situation: Pick<Situation, 'projectTypes' | 'uses' | 'existing'>): boolean {
  if (entry.appliesWhen.existing && situation.existing.length === 0) return false
  return meets(situation.projectTypes, entry.appliesWhen.projectTypes) && meets(situation.uses, entry.appliesWhen.uses)
}

function keysOf(entry: FactSource, situation: Situation): string[] {
  if (!entry.appliesWhen.existing) return [...entry.factKeys]
  return situation.existing.flatMap((buildingId) => entry.factKeys.map((key) => `${key}@${buildingId}`))
}

function settled(profile: ProjectProfile, key: string): boolean {
  return key in profile.facts || key in profile.assumptions || profile.unknowns.includes(key)
}

const sameName = (a: string, b: string) => a.localeCompare(b, 'de', { sensitivity: 'base' }) === 0

const isDeterminant = (value: string | undefined): value is DocumentRequest['determinant'] =>
  (LOCATION_DETERMINANTS as readonly string[]).includes(value ?? '')

function requestFor(entry: FactSource, situation: Situation, input: LocationRegisterInput): DocumentRequest | null {
  const keys = keysOf(entry, situation)
  if (keys.length === 0 || !isDeterminant(entry.determinant)) return null
  const territoryId = situation.subdivision?.territoryId
  const variant = territoryId ? entry.variants[territoryId] : undefined
  const additions = entry.additions.filter(
    (local) =>
      local.territoryId === territoryId && situation.municipality && sameName(local.municipality, situation.municipality)
  )
  const reason = [variant?.reason ?? entry.request.reason, ...additions.map((local) => local.addition)].join(' ')
  return {
    determinant: entry.determinant,
    label: entry.label,
    document: variant?.document ?? entry.request.document,
    reason,
    keys,
    needs: input.needs.filter((need) => keys.includes(need.key) && need.state === 'open'),
    satisfied: keys.every((key) => settled(input.profile, key)),
    sources: [...(variant?.sources ?? entry.sources), ...additions.flatMap((local) => local.sources)],
  }
}

function registerInputs(mode: IntakeMode, subdivisionKey: string): string[] {
  return mode === 'active' ? [subdivisionKey, 'work_type'] : [subdivisionKey]
}

const DEFAULT_SUBDIVISION_KEY = 'federal_state'

export function locationRegisterFor(input: LocationRegisterInput): LocationRegisterView {
  const empty: LocationRegisterView = { federalState: null, municipality: null, questions: [], documentRequests: [] }
  const scope = setupScopeOf(input.profile, { location: input.location, records: input.records })
  const unplaced = scope.chain.length === 0 && siteCountry(input.profile) === null
  const sources = factSourcesOf(scope)
  if (!sources && !unplaced) return empty
  const subdivisions = factDefinitionsOf(scope)?.subdivisions
  const subdivision =
    scope.chain.length > 1 ? (subdivisions?.options.find((option) => option.territoryId === scope.chain[0]) ?? null) : null
  const situation = situationOf(input, subdivision)
  const questions = registerInputs(input.mode, subdivisions?.factKey ?? DEFAULT_SUBDIVISION_KEY).flatMap((key) =>
    input.needs.filter((need) => need.key === key && need.state === 'open')
  )
  const documentRequests =
    input.mode === 'closing' || !sources
      ? []
      : sources.entries
          .filter((entry) => entryApplies(entry, situation))
          .map((entry) => requestFor(entry, situation, input))
          .filter((request): request is DocumentRequest => request !== null)
  return {
    federalState: subdivision?.token ?? null,
    municipality: situation.municipality,
    questions,
    documentRequests,
  }
}
