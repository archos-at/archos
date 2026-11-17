import { answerKeyFor, isBuildingId, modeKeyFor, type BuildingInstance } from '@/lib/project-profile/intake-building-keys'
import { evaluateIntakeCondition } from '@/lib/project-profile/intake-conditions'
import { answersFromProfile } from '@/lib/project-profile/intake-profile'
import { siteCountry } from '@/lib/project-profile/site'
import type { ProjectIntakeDefinition, ProjectIntakeQuestion, ProjectIntakeStage } from '@/lib/project-profile/intake-types'
import type {
  ProjectFact,
  ProjectPrimitiveValue,
  ProjectProfile,
} from '@/lib/project-profile/types'
import { deriveBuildingClass } from './derivations'
import { buildingClassificationOf, classificationInputs, setupScopeOf, type BuildingClassification } from './setup-scope'
import type { StoredRuleset } from '@/lib/base-knowledge/rulesets/select'
import {
  INTAKE_NEED_TYPES,
  MAX_INTAKE_NEEDS,
  type IntakeMode,
  type IntakeNeedType,
  type Need,
  type NeedOption,
  type NeedState,
  type OpenedNeed,
} from './types'

export interface ComputeNeedsOptions {
  mode: IntakeMode
  dismissed: ReadonlyArray<{ key: string; value: ProjectPrimitiveValue }>
  unknownKeys?: ReadonlyArray<string>
  records: readonly StoredRuleset[]
}

type Answers = Record<string, ProjectPrimitiveValue>

interface Candidate {
  question: ProjectIntakeQuestion
  type: IntakeNeedType
  key: string
  baseKey: string
  buildingId: string | null
  zone: string | null
}

const NEED_TYPES: readonly string[] = INTAKE_NEED_TYPES

function isNeedType(type: string): type is IntakeNeedType {
  return NEED_TYPES.includes(type)
}

function baseKeyOf(question: ProjectIntakeQuestion): string | null {
  const match = question.writesTo?.match(/^\/(?:facts|goals)\/([^/]+)/)
  return match ? match[1] : null
}

function knownProfile(profile: ProjectProfile): ProjectProfile {
  const suggested: Record<string, ProjectFact> = {}
  for (const [key, assumption] of Object.entries(profile.assumptions)) {
    suggested[key] = {
      value: assumption.value,
      confidence: 'confirmed',
      source: 'onboarding',
      updatedAt: assumption.updatedAt,
    }
  }
  return { ...profile, facts: { ...suggested, ...profile.facts } }
}

function candidateFor(
  question: ProjectIntakeQuestion,
  answers: Answers,
  scope: { building?: BuildingInstance; zone?: string }
): Candidate | null {
  const baseKey = baseKeyOf(question)
  if (!baseKey || !isNeedType(question.type)) return null
  if (!evaluateIntakeCondition(question, answers, scope.building?.id)) return null
  const buildingId = scope.building?.id ?? null
  return {
    question,
    type: question.type,
    key: answerKeyFor(baseKey, buildingId ?? undefined, scope.zone),
    baseKey,
    buildingId,
    zone: scope.zone ?? null,
  }
}

function zoneQuestions(stage: ProjectIntakeStage, use: string): ProjectIntakeQuestion[] {
  return [...(stage.zoneCommon ?? []), ...(stage.zoneDefinitions?.[use]?.questions ?? [])]
}

function buildingCandidates(
  stage: ProjectIntakeStage,
  building: BuildingInstance,
  answers: Answers
): Candidate[] {
  const own = stage.questions.map((question) => candidateFor(question, answers, { building }))
  const uses = answers[answerKeyFor('D0', building.id)]
  const zones = Array.isArray(uses)
    ? uses.flatMap((zone) =>
        zoneQuestions(stage, zone).map((question) =>
          candidateFor(question, answers, { building, zone })
        )
      )
    : []
  return [...own, ...zones].filter((candidate): candidate is Candidate => candidate !== null)
}

function candidatesFor(
  definition: ProjectIntakeDefinition,
  answers: Answers,
  buildings: BuildingInstance[]
): Candidate[] {
  return definition.stages.flatMap((stage) => {
    if (stage.scope === 'building')
      return buildings.flatMap((building) => buildingCandidates(stage, building, answers))
    return stage.questions
      .map((question) => candidateFor(question, answers, {}))
      .filter((candidate): candidate is Candidate => candidate !== null)
  })
}

function isUndecidedOption(option: { value: string; label: string }): boolean {
  return (
    (option.value === 'open' || option.value === 'undecided') && option.label.startsWith('noch')
  )
}

export function needOptionsFor(
  question: ProjectIntakeQuestion,
  key: string,
  dismissed: ComputeNeedsOptions['dismissed']
): NeedOption[] | undefined {
  if (!question.options) return undefined
  const refused = new Set(
    dismissed.filter((entry) => entry.key === key).map((entry) => String(entry.value))
  )
  return question.options
    .filter((option) => !isUndecidedOption(option) && !refused.has(option.value))
    .map((option) => ({ token: option.value, label: option.label }))
}

function zoneUses(definition: ProjectIntakeDefinition): Array<{ value: string; label: string }> {
  return (
    definition.stages.flatMap((stage) => stage.questions).find((question) => question.id === 'D0')
      ?.options ?? []
  )
}

function labelFor(candidate: Candidate, definition: ProjectIntakeDefinition): string {
  if (!candidate.zone) return candidate.question.label
  const use =
    zoneUses(definition).find((option) => option.value === candidate.zone)?.label ?? candidate.zone
  return `${candidate.question.label} (${use})`
}

function knownAnswer(answers: Answers, answerKey: string): ProjectPrimitiveValue | undefined {
  if (answers[modeKeyFor(answerKey)] === 'open') return undefined
  const value = answers[answerKey]
  return value === 'open' ? undefined : value
}

function buildingClassReaders(
  definition: ProjectIntakeDefinition,
  inputs: readonly string[]
): Array<{ questionId: string; input: string }> {
  return definition.stages
    .filter((stage) => stage.scope === 'building')
    .flatMap((stage) => stage.questions)
    .map((question) => ({ questionId: question.id, input: baseKeyOf(question) ?? '' }))
    .filter(({ input }) => inputs.includes(input))
}

function inputsFromAnswers(
  readers: ReadonlyArray<{ questionId: string; input: string }>,
  answers: Answers,
  buildingId: string
): Record<string, ProjectPrimitiveValue | undefined> {
  return Object.fromEntries(
    readers.map(({ questionId, input }) => [
      input,
      knownAnswer(answers, answerKeyFor(questionId, buildingId)),
    ])
  )
}

export function buildingClassInputsFor(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  buildingId: string,
  inputs: readonly string[]
): Record<string, ProjectPrimitiveValue | undefined> {
  const { answers } = answersFromProfile(knownProfile(profile), definition)
  return inputsFromAnswers(buildingClassReaders(definition, inputs), answers, buildingId)
}

function decisiveKeysFor(
  definition: ProjectIntakeDefinition,
  answers: Answers,
  buildings: BuildingInstance[],
  classification: BuildingClassification
): Set<string> {
  const readers = buildingClassReaders(definition, classificationInputs(classification))
  const decisive = new Set<string>()
  for (const building of buildings) {
    const known = inputsFromAnswers(readers, answers, building.id)
    for (const input of deriveBuildingClass(classification, known).missing)
      decisive.add(answerKeyFor(input, building.id))
  }
  return decisive
}

function decisiveFor(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  answers: Answers,
  buildings: BuildingInstance[],
  classification: BuildingClassification | null
): Set<string> {
  if (classification) return decisiveKeysFor(definition, answers, buildings, classification)
  return siteCountry(profile) === null ? new Set(SITE_KEYS) : new Set<string>()
}

const SITE_KEYS = ['country', 'federal_state'] as const

export function computeNeeds(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition,
  options: ComputeNeedsOptions
): Need[] {
  const { answers, buildings } = answersFromProfile(knownProfile(profile), definition)
  const unknown = new Set(options.unknownKeys ?? profile.unknowns)
  const classification = buildingClassificationOf(setupScopeOf(profile, { records: options.records }))
  const classInputs: readonly string[] = classificationInputs(classification)
  const decisive =
    options.mode === 'closing'
      ? new Set<string>()
      : decisiveFor(profile, definition, answers, buildings, classification)
  const needs = candidatesFor(definition, answers, buildings)
    .filter((candidate) => !(candidate.key in profile.goals))
    .filter(
      (candidate) =>
        !(candidate.key in profile.facts) || classInputs.includes(candidate.baseKey)
    )
    .filter((candidate) => !unknown.has(candidate.key))
    .map((candidate) =>
      toNeed(candidate, definition, options, decisive.has(candidate.key), profile)
    )
  const ordered = [
    ...needs.filter((need) => need.decisive),
    ...needs.filter((need) => !need.decisive && need.state !== 'confirmed'),
    ...needs.filter((need) => need.state === 'confirmed'),
  ]
  return ordered.slice(0, MAX_INTAKE_NEEDS)
}

export function openedNeeds(before: readonly Need[], after: readonly Need[]): OpenedNeed[] {
  const listed = new Set(before.map((need) => need.key))
  return after
    .filter((need) => need.state === 'open' && !listed.has(need.key))
    .map((need) => ({ key: need.key, decisive: need.decisive }))
}

function toNeed(
  candidate: Candidate,
  definition: ProjectIntakeDefinition,
  options: ComputeNeedsOptions,
  decisive: boolean,
  profile: ProjectProfile
): Need {
  const { question } = candidate
  const state = needState(candidate.key, profile)
  const needOptions = needOptionsFor(question, candidate.key, options.dismissed)
  return {
    key: candidate.key,
    baseKey: candidate.baseKey,
    buildingId: candidate.buildingId,
    label: labelFor(candidate, definition),
    type: candidate.type,
    ...(needOptions ? { options: needOptions } : {}),
    ...(question.unit ? { unit: question.unit } : {}),
    ...(question.why ? { why: question.why } : {}),
    foundIn: question.foundIn ?? [],
    decisive: decisive && state !== 'confirmed',
    state,
  }
}

function needState(key: string, profile: ProjectProfile): NeedState {
  if (key in profile.facts) return 'confirmed'
  return key in profile.assumptions ? 'suggested' : 'open'
}

export interface KeyQuestion {
  question: ProjectIntakeQuestion
  type: IntakeNeedType
  baseKey: string
  buildingId: string | null
  zone: string | null
}

function scopedParts(
  scope: 'project' | 'building' | 'zone',
  parts: string[]
): { buildingId: string | null; zone: string | null } | null {
  const [, buildingId, zone] = parts
  if (scope === 'project') return parts.length === 1 ? { buildingId: null, zone: null } : null
  if (!isBuildingId(buildingId ?? '')) return null
  if (scope === 'building') return parts.length === 2 ? { buildingId, zone: null } : null
  return parts.length === 3 && zone ? { buildingId, zone } : null
}

function writers(definition: ProjectIntakeDefinition): Array<{
  question: ProjectIntakeQuestion
  scope: 'project' | 'building' | 'zone'
  uses: readonly string[] | null
}> {
  const allUses = zoneUses(definition).map((option) => option.value)
  return definition.stages.flatMap((stage) => [
    ...stage.questions.map((question) => ({
      question,
      scope: stage.scope === 'building' ? ('building' as const) : ('project' as const),
      uses: null,
    })),
    ...(stage.zoneCommon ?? []).map((question) => ({ question, scope: 'zone' as const, uses: allUses })),
    ...Object.entries(stage.zoneDefinitions ?? {}).flatMap(([use, zone]) =>
      zone.questions.map((question) => ({ question, scope: 'zone' as const, uses: [use] }))
    ),
  ])
}

export function questionForKey(
  definition: ProjectIntakeDefinition,
  key: string
): KeyQuestion | null {
  const parts = key.split('@')
  const baseKey = parts[0]
  for (const writer of writers(definition)) {
    if (baseKeyOf(writer.question) !== baseKey) continue
    const scoped = scopedParts(writer.scope, parts)
    if (!scoped || !isNeedType(writer.question.type)) return null
    if (scoped.zone !== null && !writer.uses?.includes(scoped.zone)) return null
    return { question: writer.question, type: writer.question.type, baseKey, ...scoped }
  }
  return null
}

export function recordableKey(
  definition: ProjectIntakeDefinition,
  key: string,
  buildingIds: readonly string[]
): KeyQuestion | null {
  const found = questionForKey(definition, key)
  if (!found) return null
  return found.buildingId === null || buildingIds.includes(found.buildingId) ? found : null
}
