import type { DerivationReview, IntakeDecision, IntakeView, Suggestion, SuggestionGroup } from '@/lib/project-intake/types'

export const TOP_FINDINGS = 5

export function findings(groups: readonly SuggestionGroup[]): Suggestion[] {
  return groups.flatMap((group) => group.items).filter((item) => item.state !== 'contested')
}

function classInputKeys(derivations: readonly DerivationReview[]): Set<string> {
  return new Set(derivations.flatMap((derivation) => derivation.inputs.map((input) => input.key)))
}

function rank(item: Suggestion, inputs: Set<string>): number {
  if (item.decisive && item.state === 'suggested') return 0
  if (inputs.has(item.key)) return 1
  if (item.evidence.some((entry) => entry.kind === 'document')) return 2
  return 3
}

export function topFindings(
  groups: readonly SuggestionGroup[],
  derivations: readonly DerivationReview[],
  limit: number = TOP_FINDINGS
): Suggestion[] {
  const inputs = classInputKeys(derivations)
  return findings(groups)
    .map((item, index) => ({ item, index, rank: rank(item, inputs) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item)
}

export function restByTopic(groups: readonly SuggestionGroup[], shown: readonly Suggestion[]): SuggestionGroup[] {
  const apart = new Set(shown.map((item) => item.key))
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => item.state !== 'contested' && !apart.has(item.key)),
    }))
    .filter((group) => group.items.length > 0)
}

export function finishDecisions(view: Pick<IntakeView, 'groups' | 'derivations'>): IntakeDecision[] {
  const classes = view.derivations.flatMap(({ suggestion }): IntakeDecision[] =>
    suggestion?.state === 'suggested' ? [{ key: suggestion.key, action: 'confirm' }] : []
  )
  return [...takeAllDecisions(view.groups), ...classes]
}

export function takeAllDecisions(groups: readonly SuggestionGroup[]): IntakeDecision[] {
  return findings(groups)
    .filter((item) => item.state === 'suggested')
    .map((item): IntakeDecision => ({ key: item.key, action: 'confirm' }))
}

export function shortLabel(label: string): string {
  const short = label.replace(/\s*\([^()]*\)\s*$/u, '').trim()
  return short.length > 0 ? short : label
}

export function documentName(fileName: string): string {
  const trimmed = fileName.trim()
  const dot = trimmed.lastIndexOf('.')
  return dot > 0 && trimmed.length - dot <= 5 ? trimmed.slice(0, dot) : trimmed
}

export function leadDerivation(derivations: readonly DerivationReview[]): DerivationReview | null {
  return (
    derivations.find((derivation) => derivation.suggestion?.state === 'suggested') ??
    derivations.find((derivation) => derivation.value !== null || derivation.highRise) ??
    derivations[0] ??
    null
  )
}

export const REASON_INPUTS = [
  'escape_level_m',
  'storeys_above_ground',
  'use_units',
  'units_over_400',
  'gfa_above_ground',
] as const
export type ReasonInput = (typeof REASON_INPUTS)[number]

export const REASON_INPUT_IDS = {
  escape_level_m: 'escapeLevel',
  storeys_above_ground: 'storeysAboveGround',
  use_units: 'units',
  units_over_400: 'unitOver400',
  gfa_above_ground: 'grossFloorArea',
} as const satisfies Record<ReasonInput, string>

export function reasonInputs(
  derivation: DerivationReview,
  limit = 3
): Array<{ base: ReasonInput; key: string; value: DerivationReview['inputs'][number]['value'] }> {
  const byBase = new Map(derivation.inputs.map((input) => [input.key.split('@')[0], input]))
  return REASON_INPUTS.flatMap((base) => {
    const input = byBase.get(base)
    return input ? [{ base, key: input.key, value: input.value }] : []
  }).slice(0, limit)
}

export function confirmedCount(view: Pick<IntakeView, 'groups' | 'derivations'>): number {
  const values = view.groups.flatMap((group) => group.items).filter((item) => item.state === 'confirmed').length
  const classes = view.derivations.filter((derivation) => derivation.suggestion?.state === 'confirmed').length
  return values + classes
}
