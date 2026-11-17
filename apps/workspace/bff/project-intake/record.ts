import type { ProjectIntakeDefinition } from '@/lib/project-profile/intake-types'
import { validateProfilePatchVocabulary } from '@/lib/project-profile/intake-vocabulary'
import type { DocumentEvidence } from '@/lib/project-profile/evidence-schema'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import {
  buildingsTouchedBy,
  buildingIdsOf,
  buildingClassKey,
  classificationFor,
  isBuildingClassKey,
  withDerivedClass,
} from './derivation-view'
import { classificationInputs, setupUnpublished, type SetupScopeOptions } from './setup-scope'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import {
  isMeaningfulValue,
  pointerSegment,
  sameProfileValue,
  suggestedAssumption,
  withAlternative,
  withEvidence,
} from './profile-edits'
import { computeNeeds, needOptionsFor, openedNeeds, questionForKey, recordableKey, type ComputeNeedsOptions } from './needs'
import type {
  DismissedValue,
  OpenedNeed,
  RecordRefusalReason,
  RecordResult,
  RecordValue,
  WithdrawRefusalReason,
  WithdrawResult,
} from './types'

export interface RecordScreen {
  definition: ProjectIntakeDefinition
  dismissed: readonly DismissedValue[]
  readableFiles: ReadonlySet<string>
}

function outsideVocabulary(value: RecordValue, definition: ProjectIntakeDefinition): boolean {
  if (!isMeaningfulValue(value.value)) return true
  try {
    validateProfilePatchVocabulary([
      { op: 'add', path: `/assumptions/${pointerSegment(value.key)}`, value: value.value },
    ])
  } catch {
    return true
  }
  const found = questionForKey(definition, value.key)
  const options = found ? needOptionsFor(found.question, value.key, []) : undefined
  if (!options || options.length === 0) return false
  const tokens = new Set(options.map((option) => option.token))
  const given = Array.isArray(value.value) ? value.value : [value.value]
  return !given.every((token) => typeof token === 'string' && tokens.has(token))
}

export function staticRefusal(value: RecordValue, screen: RecordScreen): RecordRefusalReason | null {
  if (outsideVocabulary(value, screen.definition)) return 'vocabulary'
  const dismissed = screen.dismissed.some(
    (entry) => entry.key === value.key && sameProfileValue(entry.value, value.value)
  )
  if (dismissed) return 'dismissed'
  if (!screen.readableFiles.has(value.evidence.fileName)) return 'unreadable-file'
  return null
}

export interface ScreenedValue {
  key: string
  value: ProjectPrimitiveValue
  evidence: DocumentEvidence
  reason: string
}

export interface RecordContext {
  now: string
  readingId: string
  needs: ComputeNeedsOptions
  records: readonly StoredRuleset[]
  lawWithheld?: boolean
}

function applyValue(
  profile: ProjectProfile,
  item: ScreenedValue,
  recordable: (key: string) => boolean,
  context: RecordContext
): { profile: ProjectProfile; result: RecordResult } {
  const { now } = context
  const { key, value, evidence } = item
  if (isBuildingClassKey(key)) return { profile, result: { key, outcome: 'refused', reason: 'unknown-key' } }
  const fact = profile.facts[key]
  if (fact) {
    const corroborates = sameProfileValue(fact.value, value)
    const next = corroborates
      ? { ...fact, evidence: withEvidence(fact.evidence, evidence) }
      : { ...fact, alternatives: withAlternative(fact.alternatives, value, evidence, now) }
    return {
      profile: { ...profile, facts: { ...profile.facts, [key]: next } },
      result: { key, outcome: corroborates ? 'corroborated' : 'contradiction' },
    }
  }
  if (!recordable(key)) return { profile, result: { key, outcome: 'refused', reason: 'unknown-key' } }

  const assumption = profile.assumptions[key]
  if (assumption) {
    const corroborates = sameProfileValue(assumption.value, value)
    const next = corroborates
      ? { ...assumption, evidence: withEvidence(assumption.evidence, evidence) }
      : { ...assumption, alternatives: withAlternative(assumption.alternatives, value, evidence, now) }
    return {
      profile: { ...profile, assumptions: { ...profile.assumptions, [key]: next } },
      result: { key, outcome: corroborates ? 'corroborated' : 'contradiction' },
    }
  }
  const created = { ...suggestedAssumption(value, item.reason, [evidence], now), readingId: context.readingId }
  return {
    profile: { ...profile, assumptions: { ...profile.assumptions, [key]: created } },
    result: { key, outcome: 'suggested' },
  }
}

export interface RecordPlan {
  results: RecordResult[]
  profile: ProjectProfile
  changedKeys: string[]
  opened: OpenedNeed[]
}

function withClassesDerived(
  before: ProjectProfile,
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  changed: Set<string>,
  now: string,
  scope: Pick<SetupScopeOptions, 'records' | 'lawWithheld'>,
  everyBuilding = false
): ProjectProfile {
  if (scope.lawWithheld) return profile
  if (setupUnpublished(before, scope.records) && setupUnpublished(profile, scope.records)) return profile
  let current = profile
  const classification = classificationFor(current, scope)
  const all = buildingIdsOf(current, definition)
  const moved = classificationFor(before, scope)?.rulesetId !== classification?.rulesetId
  const touched =
    classification && !moved && !everyBuilding ? buildingsTouchedBy(changed, all, classificationInputs(classification)) : all
  for (const buildingId of touched) {
    const derived = withDerivedClass(current, definition, buildingId, now, scope)
    current = derived.profile
    if (derived.changed) changed.add(buildingClassKey(buildingId))
  }
  return current
}

export function planRecord(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  values: ReadonlyArray<{ key: string; screened: ScreenedValue | null; refusal: RecordRefusalReason | null }>,
  context: RecordContext
): RecordPlan {
  const buildingIds = buildingIdsOf(profile, definition)
  const recordable = (key: string) => recordableKey(definition, key, buildingIds) !== null
  let current = profile
  const results: RecordResult[] = []
  const changed = new Set<string>()
  for (const entry of values) {
    if (entry.refusal || !entry.screened) {
      results.push({ key: entry.key, outcome: 'refused', reason: entry.refusal ?? 'vocabulary' })
      continue
    }
    const applied = applyValue(current, entry.screened, recordable, context)
    current = applied.profile
    results.push(applied.result)
    if (applied.result.outcome !== 'refused') changed.add(entry.key)
  }
  current = withClassesDerived(profile, current, definition, changed, context.now, { records: context.records, lawWithheld: context.lawWithheld })
  const opened = openedNeeds(
    computeNeeds(profile, definition, context.needs),
    computeNeeds(current, definition, context.needs)
  )
  return { results, profile: current, changedKeys: [...changed], opened }
}

export function planRederive(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  context: Pick<RecordContext, 'now' | 'records' | 'lawWithheld'>
): { profile: ProjectProfile; changedKeys: string[] } {
  const changed = new Set<string>()
  const scope = { records: context.records, lawWithheld: context.lawWithheld }
  const current = withClassesDerived(profile, profile, definition, changed, context.now, scope, true)
  return { profile: current, changedKeys: [...changed] }
}

export function withdrawRefusal(profile: ProjectProfile, key: string, readingId: string): WithdrawRefusalReason | null {
  if (profile.facts[key]) return 'confirmed'
  const assumption = profile.assumptions[key]
  if (!assumption) return 'nothing-suggested'
  if (assumption.source !== 'agent_suggested' || assumption.readingId !== readingId) return 'not-this-reading'
  return null
}

export interface WithdrawPlan {
  results: WithdrawResult[]
  profile: ProjectProfile
  changedKeys: string[]
}

export function planWithdraw(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  keys: readonly string[],
  context: Pick<RecordContext, 'now' | 'readingId' | 'records' | 'lawWithheld'>
): WithdrawPlan {
  let current = profile
  const results: WithdrawResult[] = []
  const changed = new Set<string>()
  for (const key of keys) {
    const reason = withdrawRefusal(current, key, context.readingId)
    if (reason) {
      results.push({ key, outcome: 'refused', reason })
      continue
    }
    const assumptions = { ...current.assumptions }
    delete assumptions[key]
    current = { ...current, assumptions }
    results.push({ key, outcome: 'withdrawn' })
    changed.add(key)
  }
  current = withClassesDerived(profile, current, definition, changed, context.now, { records: context.records, lawWithheld: context.lawWithheld })
  return { results, profile: current, changedKeys: [...changed] }
}
