import { applyProjectProfilePatch, emptyProjectProfile } from './patch-engine'
import type { ProjectAssumption, ProjectFact, ProjectPrimitiveValue, ProjectProfile, ProjectProfilePatchOperation } from './types'
import { BUILDING_ID_IN_KEY, type BuildingInstance, answerKeyFor, buildingNumber, defaultBuildings, modeKeyFor } from './intake-building-keys'
import { FEDERAL_STATE_TOKENS, type WriteTarget, buildingsFromAnswers, evaluateIntakeCondition, flattenIntakeQuestions, isIntakeAnswerProvided } from './intake-conditions'
import { applyLegacyAnswerBridges } from './intake-legacy-answers'
import type { IntakeAnswerMode, ProjectIntakeDefinition, ProjectIntakeQuestion, ProjectIntakeStage } from './intake-types'

export function resolveWriteTarget(writesTo: string | undefined): WriteTarget | null {
  if (!writesTo) return null
  const factMatch = writesTo.match(/^\/facts\/([^/]+)/)
  if (factMatch) return { scope: 'facts', key: factMatch[1] }
  const goalMatch = writesTo.match(/^\/goals\/([^/]+)/)
  if (goalMatch) return { scope: 'goals', key: goalMatch[1] }
  return null
}

function instanceStorageKey(baseKey: string, buildingId?: string, zoneKey?: string): string {
  let key = baseKey
  if (buildingId) key += `@${buildingId}`
  if (zoneKey) key += `@${zoneKey}`
  return key
}

const NOW_SOURCE = 'onboarding' as const

interface BuildContext {
  now: string
  patch: ProjectProfilePatchOperation[]
  unknowns: string[]
}

function emitAnswer(
  ctx: BuildContext,
  question: ProjectIntakeQuestion,
  answerKey: string,
  storageKey: string,
  target: WriteTarget,
  answers: Record<string, ProjectPrimitiveValue>
): void {
  const raw = answers[answerKey]

  if (question.type === 'yes_no_open') {
    if (raw === 'yes' || raw === 'no') {
      addFact(ctx, target, storageKey, raw === 'yes')
    } else {
      ctx.unknowns.push(storageKey)
    }
    return
  }

  if (question.type === 'number_tri') {
    const mode = (answers[modeKeyFor(answerKey)] as IntakeAnswerMode) ?? 'value'
    if (mode === 'open' || !isIntakeAnswerProvided(raw)) {
      ctx.unknowns.push(storageKey)
      return
    }
    const numeric = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isFinite(numeric)) {
      ctx.unknowns.push(storageKey)
      return
    }
    if (mode === 'estimated') {
      ctx.patch.push({
        op: 'add',
        path: `/assumptions/${encodeKey(storageKey)}`,
        value: {
          value: numeric,
          status: 'unconfirmed',
          reason: 'Während der Erhebung geschätzt',
          source: 'onboarding_default',
          updatedAt: ctx.now,
        },
      })
    } else {
      addFact(ctx, target, storageKey, numeric)
    }
    return
  }

  if (!isIntakeAnswerProvided(raw)) {
    ctx.unknowns.push(storageKey)
    return
  }
  const value: ProjectPrimitiveValue = Array.isArray(raw) ? [...raw] : raw
  addFact(ctx, target, storageKey, value)
}

function addFact(
  ctx: BuildContext,
  target: WriteTarget,
  storageKey: string,
  value: ProjectPrimitiveValue
): void {
  if (target.scope === 'goals') {
    ctx.patch.push({ op: 'add', path: `/goals/${encodeKey(storageKey)}`, value })
  } else {
    ctx.patch.push({
      op: 'add',
      path: `/facts/${encodeKey(storageKey)}`,
      value: { value, confidence: 'confirmed', source: NOW_SOURCE, updatedAt: ctx.now },
    })
  }
}

function encodeKey(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

export function buildIntakeProfile(
  answers: Record<string, ProjectPrimitiveValue>,
  definition: ProjectIntakeDefinition,
  options?: {
    projectName?: string
    buildings?: BuildingInstance[]
  }
): ProjectProfile {
  const ctx: BuildContext = { now: new Date().toISOString(), patch: [], unknowns: [] }
  const buildings = options?.buildings ?? buildingsFromAnswers(answers)

  const projectName = options?.projectName?.trim()
  if (projectName && !isIntakeAnswerProvided(answers['A1'])) {
    ctx.patch.push({
      op: 'add',
      path: '/facts/project_name',
      value: {
        value: projectName,
        confidence: 'confirmed',
        source: NOW_SOURCE,
        updatedAt: ctx.now,
      },
    })
  }

  if (buildings.length > 1 || buildings[0]?.name !== 'Bauwerk 1') {
    for (const building of buildings) {
      ctx.patch.push({
        op: 'add',
        path: `/facts/${encodeKey(`building_name@${building.id}`)}`,
        value: { value: building.name, confidence: 'confirmed', source: NOW_SOURCE, updatedAt: ctx.now },
      })
    }
  }

  for (const stage of definition.stages) {
    if (stage.scope === 'building') {
      for (const building of buildings) emitStageForBuilding(ctx, stage, building, answers)
    } else {
      for (const question of stage.questions) {
        const target = resolveWriteTarget(question.writesTo)
        if (!target) continue
        if (!evaluateIntakeCondition(question, answers)) continue
        emitAnswer(ctx, question, question.id, target.key, target, answers)
      }
    }
  }

  const federalStatePath = '/facts/federal_state'

  const unwrapFactValue = (value: unknown): unknown =>
    typeof value === 'object' && value !== null && 'value' in value
      ? (value as { value: unknown }).value
      : value

  const hasCountry = ctx.patch.some((p) => p.path === '/facts/country')
  const federalStatePatch = ctx.patch.find((p) => p.path === federalStatePath)
  if (!hasCountry && federalStatePatch) {
    const bToken = unwrapFactValue(federalStatePatch.value)
    if (
      typeof bToken === 'string' &&
      bToken !== 'outside_austria' &&
      (FEDERAL_STATE_TOKENS as readonly string[]).includes(bToken)
    ) {
      ctx.patch.push({
        op: 'add',
        path: '/facts/country',
        value: { value: 'at', confidence: 'confirmed', source: NOW_SOURCE, updatedAt: ctx.now },
      })
    }
  }

  const countryFact = ctx.patch.find((p) => p.path === '/facts/country')
  const hasFederalState = ctx.patch.some((p) => p.path === federalStatePath)
  const countryValue = unwrapFactValue(countryFact?.value)
  if (countryFact && typeof countryValue === 'string' && countryValue !== 'at' && !hasFederalState) {
    ctx.patch.push({
      op: 'add',
      path: federalStatePath,
      value: {
        value: 'outside_austria',
        confidence: 'confirmed',
        source: NOW_SOURCE,
        updatedAt: ctx.now,
      },
    })
  }

  for (const key of ctx.unknowns) {
    ctx.patch.push({ op: 'add', path: '/unknowns/-', value: key })
  }

  return applyProjectProfilePatch(emptyProjectProfile(), ctx.patch)
}

function emitStageForBuilding(
  ctx: BuildContext,
  stage: ProjectIntakeStage,
  building: BuildingInstance,
  answers: Record<string, ProjectPrimitiveValue>
): void {
  for (const question of stage.questions) {
    const target = resolveWriteTarget(question.writesTo)
    if (!target) continue
    if (!evaluateIntakeCondition(question, answers, building.id)) continue
    const answerKey = answerKeyFor(question.id, building.id)
    emitAnswer(ctx, question, answerKey, instanceStorageKey(target.key, building.id), target, answers)
  }

  if (!stage.zoneDefinitions && !stage.zoneCommon) return
  const selectedUses = answers[answerKeyFor('D0', building.id)]
  if (!Array.isArray(selectedUses)) return

  for (const use of selectedUses) {
    const zoneQuestions = [
      ...(stage.zoneCommon ?? []),
      ...(stage.zoneDefinitions?.[use]?.questions ?? []),
    ]
    for (const question of zoneQuestions) {
      const target = resolveWriteTarget(question.writesTo)
      if (!target) continue
      const answerKey = answerKeyFor(question.id, building.id, use)
      emitAnswer(
        ctx,
        question,
        answerKey,
        instanceStorageKey(target.key, building.id, use),
        target,
        answers
      )
    }
  }
}

function sameProfileValue(a: ProjectPrimitiveValue, b: ProjectPrimitiveValue): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    const sortedB = [...b].sort()
    return a.length === b.length && [...a].sort().every((item, index) => item === sortedB[index])
  }
  return a === b
}

function carryOverProvenance<Entry extends ProjectFact | ProjectAssumption>(
  built: Record<string, Entry>,
  previous: ProjectProfile,
  options: { evidence: boolean }
): Record<string, Entry> {
  return Object.fromEntries(
    Object.entries(built).map(([key, entry]) => {
      const before = previous.facts[key] ?? previous.assumptions[key]
      if (!before) return [key, entry]
      const alternatives = before.alternatives?.filter(
        (alternative) => !sameProfileValue(alternative.value, entry.value)
      )
      const carried: Entry = { ...entry }
      if (
        options.evidence &&
        before.evidence?.length &&
        sameProfileValue(before.value, entry.value)
      )
        carried.evidence = before.evidence
      if (alternatives?.length) carried.alternatives = alternatives
      return [key, carried]
    })
  )
}

export function mergeIntakeProfile(
  built: ProjectProfile,
  previous: ProjectProfile | null | undefined,
  definition: ProjectIntakeDefinition
): ProjectProfile {
  if (!previous) return built

  const intakeFactBaseKeys = new Set<string>(['project_name', 'building_name'])
  const intakeGoalBaseKeys = new Set<string>()
  for (const question of flattenIntakeQuestions(definition)) {
    const target = resolveWriteTarget(question.writesTo)
    if (!target) continue
    ;(target.scope === 'goals' ? intakeGoalBaseKeys : intakeFactBaseKeys).add(target.key)
  }
  const baseKeyOf = (key: string): string => key.split('@')[0]
  const isIntakeFact = (key: string) => intakeFactBaseKeys.has(baseKeyOf(key))
  const isIntakeGoal = (key: string) => intakeGoalBaseKeys.has(baseKeyOf(key))

  const facts = {
    ...Object.fromEntries(Object.entries(previous.facts).filter(([key]) => !isIntakeFact(key))),
    ...carryOverProvenance(built.facts, previous, { evidence: true }),
  }
  const goals = {
    ...Object.fromEntries(Object.entries(previous.goals).filter(([key]) => !isIntakeGoal(key))),
    ...built.goals,
  }
  const assumptions = {
    ...Object.fromEntries(
      Object.entries(previous.assumptions).filter(
        ([key, assumption]) =>
          (!isIntakeFact(key) && !isIntakeGoal(key)) ||
          (assumption.source === 'agent_suggested' &&
            !(key in built.facts) &&
            !(key in built.assumptions))
      )
    ),
    ...carryOverProvenance(built.assumptions, previous, { evidence: false }),
  }

  const unknowns = [...built.unknowns]
  for (const key of previous.unknowns) {
    if (isIntakeFact(key) || isIntakeGoal(key)) continue
    if (unknowns.includes(key)) continue
    if (key in facts || key in goals) continue
    unknowns.push(key)
  }

  return { facts, goals, unknowns, assumptions }
}

export function answersFromProfile(
  profile: ProjectProfile,
  definition: ProjectIntakeDefinition
): {
  answers: Record<string, ProjectPrimitiveValue>
  buildings: BuildingInstance[]
} {
  const answers: Record<string, ProjectPrimitiveValue> = {}

  const foundIds = new Set<string>()
  const collectId = (key: string) => {
    const m = key.match(BUILDING_ID_IN_KEY)
    if (m) foundIds.add(m[1])
  }
  Object.keys(profile.facts).forEach(collectId)
  Object.keys(profile.assumptions).forEach(collectId)
  profile.unknowns.forEach(collectId)
  const buildings: BuildingInstance[] =
    foundIds.size === 0
      ? defaultBuildings()
      : [...foundIds]
          .sort((a, b) => buildingNumber(a) - buildingNumber(b))
          .map((id, i) => {
            const stored = profile.facts[`building_name@${id}`]?.value
            return { id, name: typeof stored === 'string' && stored ? stored : `Bauwerk ${i + 1}` }
          })

  const readInto = (question: ProjectIntakeQuestion, answerKey: string, storageKey: string) => {
    const target = resolveWriteTarget(question.writesTo)
    if (!target) return

    if (question.type === 'number_tri') {
      const fact = profile.facts[storageKey]
      const assumption = profile.assumptions[storageKey]
      if (fact !== undefined && typeof fact.value === 'number') {
        answers[answerKey] = fact.value
        answers[modeKeyFor(answerKey)] = 'value'
      } else if (assumption !== undefined && typeof assumption.value === 'number') {
        answers[answerKey] = assumption.value
        answers[modeKeyFor(answerKey)] = 'estimated'
      } else if (profile.unknowns.includes(storageKey)) {
        answers[modeKeyFor(answerKey)] = 'open'
      }
      return
    }

    if (question.type === 'yes_no_open') {
      const fact = profile.facts[storageKey]
      if (fact !== undefined && typeof fact.value === 'boolean') {
        answers[answerKey] = fact.value ? 'yes' : 'no'
      } else if (profile.unknowns.includes(storageKey)) {
        answers[answerKey] = 'open'
      }
      return
    }

    let value: ProjectPrimitiveValue | undefined =
      target.scope === 'goals' ? profile.goals?.[storageKey] : profile.facts?.[storageKey]?.value
    if (value === undefined || value === null) return
    if (question.type === 'multi_select' && typeof value === 'string') {
      try {
        const parsed: unknown = JSON.parse(value)
        if (Array.isArray(parsed)) value = parsed as string[]
      } catch {
        /* keep as-is */
      }
    }
    answers[answerKey] = value
  }

  for (const stage of definition.stages) {
    if (stage.scope === 'building') {
      for (const building of buildings) {
        for (const q of stage.questions) {
          const target = resolveWriteTarget(q.writesTo)
          if (target) readInto(q, answerKeyFor(q.id, building.id), instanceStorageKey(target.key, building.id))
        }
        const uses = answers[answerKeyFor('D0', building.id)]
        if (Array.isArray(uses)) {
          for (const use of uses) {
            const zoneQs = [
              ...(stage.zoneCommon ?? []),
              ...(stage.zoneDefinitions?.[use]?.questions ?? []),
            ]
            for (const q of zoneQs) {
              const target = resolveWriteTarget(q.writesTo)
              if (target)
                readInto(
                  q,
                  answerKeyFor(q.id, building.id, use),
                  instanceStorageKey(target.key, building.id, use)
                )
            }
          }
        }
      }
    } else {
      for (const q of stage.questions) {
        const target = resolveWriteTarget(q.writesTo)
        if (target) readInto(q, q.id, target.key)
      }
    }
  }

  applyLegacyAnswerBridges(profile, answers, buildings)

  return { answers, buildings }
}
