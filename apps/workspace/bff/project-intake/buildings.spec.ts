/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { projectIntakeDefinitionV1 as definition } from '@/lib/project-profile/intake-definition'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import { AT_SETUP_RECORDS } from './at-setup.fixtures'
import { BUILDING_REFUSALS, buildingsOf, planBuildingOperation, type BuildingContext, type BuildingPlan } from './buildings'
import { computeNeeds, type ComputeNeedsOptions } from './needs'
import { patchForKeys } from './profile-edits'
import { planRecord, type ScreenedValue } from './record'
import { MAX_INTAKE_BUILDINGS, type BuildingOperation } from './types'

const NOW = '2026-11-22T08:00:00.000Z'
const context: BuildingContext = { userId: 'user_1', now: NOW, dismissed: [] }
const needsOptions: ComputeNeedsOptions = { mode: 'active', dismissed: [], records: AT_SETUP_RECORDS }

function profileWith(
  facts: Record<string, ProjectPrimitiveValue>,
  suggestions: Record<string, ProjectPrimitiveValue> = {},
  unknowns: string[] = []
): ProjectProfile {
  const profile = emptyProjectProfile()
  profile.facts.country = { value: 'at', confidence: 'confirmed', source: 'onboarding', updatedAt: NOW }
  for (const [key, value] of Object.entries(facts)) {
    profile.facts[key] = { value, confidence: 'confirmed', source: 'onboarding', updatedAt: NOW }
  }
  for (const [key, value] of Object.entries(suggestions)) {
    profile.assumptions[key] = { value, status: 'unconfirmed', reason: 'gelesen', source: 'agent_suggested', updatedAt: NOW }
  }
  profile.unknowns.push(...unknowns)
  return profile
}

type Planned = Extract<BuildingPlan, { ok: true }>

function plan(profile: ProjectProfile, operation: BuildingOperation, given: BuildingContext = context): Planned {
  const planned = planBuildingOperation(profile, definition, operation, given)
  if (!planned.ok) throw new Error(`refused: ${planned.refusal}`)
  return planned
}

const refusal = (profile: ProjectProfile, operation: BuildingOperation): string | null => {
  const planned = planBuildingOperation(profile, definition, operation, context)
  return planned.ok ? null : planned.refusal
}

const twoBuildings = () =>
  plan(profileWith({ 'building_type@bldg1': 'building', 'escape_level_m@bldg1': 28 }), { action: 'add', name: 'Haus B' }).profile

describe('adding a building', () => {
  it('writes its name as a confirmed fact under the next free id, with the person as evidence', () => {
    const planned = plan(profileWith({ 'building_type@bldg1': 'building' }), { action: 'add', name: 'Haus B' })

    expect(planned.buildingId).toBe('bldg2')
    expect(planned.profile.facts['building_name@bldg2']).toMatchObject({
      value: 'Haus B',
      confidence: 'confirmed',
      source: 'user_confirmed',
      evidence: [{ kind: 'person', userId: 'user_1', at: NOW }],
    })
    expect(buildingsOf(planned.profile, definition).map((building) => building.name)).toEqual(['Bauwerk 1', 'Haus B'])
  })

  it('keeps the building a profile describes only by default: an empty project has two buildings after one add', () => {
    const planned = plan(emptyProjectProfile(), { action: 'add' })

    expect(buildingsOf(planned.profile, definition)).toEqual([
      { id: 'bldg1', name: 'Bauwerk 1' },
      { id: 'bldg2', name: 'Bauwerk 2' },
    ])
    expect(planned.changedKeys).toEqual(['building_name@bldg1', 'building_name@bldg2'])
  })

  it('never hands out the id of a building whose values a person dismissed', () => {
    const dismissed = [{ key: 'escape_level_m@bldg3', value: 12 }]
    const planned = plan(twoBuildings(), { action: 'add' }, { ...context, dismissed })

    expect(planned.buildingId).toBe('bldg4')
  })

  it('names a building without a name by a number no other building carries', () => {
    const renamed = plan(twoBuildings(), { action: 'rename', buildingId: 'bldg1', name: 'Bauwerk 3' }).profile
    const planned = plan(renamed, { action: 'add' })

    expect(planned.profile.facts[`building_name@${planned.buildingId}`]?.value).toBe('Bauwerk 4')
  })

  it(`refuses a building beyond ${MAX_INTAKE_BUILDINGS}`, () => {
    let profile = emptyProjectProfile()
    for (let count = 1; count < MAX_INTAKE_BUILDINGS; count += 1) profile = plan(profile, { action: 'add' }).profile

    expect(refusal(profile, { action: 'add' })).toBe(BUILDING_REFUSALS.tooManyBuildings)
  })

  it('makes the reading’s needs list the new building’s questions', () => {
    const before = profileWith({ 'building_type@bldg1': 'building' })
    const needsOf = (profile: ProjectProfile) =>
      computeNeeds(profile, definition, needsOptions).filter((need) => need.buildingId === 'bldg2')

    expect(needsOf(before)).toEqual([])
    const after = plan(before, { action: 'add', name: 'Haus B' }).profile
    expect(needsOf(after).map((need) => need.key)).toContain('building_type@bldg2')
  })

  it('makes a finding on the new building recordable, where it was refused as an unknown key before', () => {
    const found: ScreenedValue = {
      key: 'building_type@bldg2',
      value: 'building',
      evidence: { kind: 'document', fileName: 'Lageplan.pdf', page: 1, quote: 'Haus B, Wohngebäude' },
      reason: 'Lageplan.pdf, S. 1',
    }
    const record = (profile: ProjectProfile) =>
      planRecord(profile, definition, [{ key: found.key, screened: found, refusal: null }], {
        now: NOW,
        readingId: 'intake-job-1',
        needs: needsOptions,
        records: AT_SETUP_RECORDS,
      })
    const before = profileWith({ 'building_type@bldg1': 'building' })

    expect(record(before).results).toEqual([{ key: found.key, outcome: 'refused', reason: 'unknown-key' }])
    const recorded = record(plan(before, { action: 'add', name: 'Haus B' }).profile)
    expect(recorded.results).toEqual([{ key: found.key, outcome: 'suggested' }])
    expect(recorded.profile.assumptions[found.key]?.value).toBe('building')
  })
})

describe('renaming a building', () => {
  it('replaces the name fact and nothing else', () => {
    const before = twoBuildings()
    const planned = plan(before, { action: 'rename', buildingId: 'bldg2', name: 'Turm B' })

    expect(planned.changedKeys).toEqual(['building_name@bldg2'])
    expect(planned.profile.facts['building_name@bldg2']?.value).toBe('Turm B')
    expect(planned.profile.facts['escape_level_m@bldg1']).toBe(before.facts['escape_level_m@bldg1'])
  })

  it('names the one building a profile describes only by default', () => {
    const planned = plan(emptyProjectProfile(), { action: 'rename', buildingId: 'bldg1', name: 'Hoftrakt' })

    expect(buildingsOf(planned.profile, definition)).toEqual([{ id: 'bldg1', name: 'Hoftrakt' }])
  })

  it('refuses a building the profile does not describe', () => {
    expect(refusal(twoBuildings(), { action: 'rename', buildingId: 'bldg7', name: 'Turm' })).toBe(
      BUILDING_REFUSALS.unknownBuilding
    )
  })
})

describe('removing a building', () => {
  const full = () => {
    const profile = profileWith(
      { 'building_type@bldg1': 'building', 'building_type@bldg2': 'building', 'uses@bldg2': ['residential'] },
      { 'escape_level_m@bldg2': 31, 'building_class@bldg2': 5, 'storeys_above_ground@bldg1': 3 },
      ['gfa_above_ground@bldg2', 'gfa_above_ground@bldg1']
    )
    return plan(profile, { action: 'add', name: 'Haus C' }).profile
  }

  it('deletes every key of that building from facts, suggestions and unknowns, and leaves the others', () => {
    const before = full()
    const planned = plan(before, { action: 'remove', buildingId: 'bldg2' })
    const left = [
      ...Object.keys(planned.profile.facts),
      ...Object.keys(planned.profile.assumptions),
      ...planned.profile.unknowns,
    ]

    expect(left.filter((key) => key.includes('@bldg2'))).toEqual([])
    expect(left).toEqual(
      expect.arrayContaining(['country', 'building_type@bldg1', 'storeys_above_ground@bldg1', 'gfa_above_ground@bldg1', 'building_name@bldg3'])
    )
    expect(buildingsOf(planned.profile, definition).map((building) => building.id)).toEqual(['bldg1', 'bldg3'])
  })

  it('reaches the profile as remove operations for exactly those keys', () => {
    const before = full()
    const planned = plan(before, { action: 'remove', buildingId: 'bldg2' })
    const operations = patchForKeys(before, planned.profile, planned.changedKeys)

    expect(operations.filter((operation) => operation.op === 'remove').map((operation) => operation.path).sort()).toEqual([
      '/assumptions/building_class@bldg2',
      '/assumptions/escape_level_m@bldg2',
      '/facts/building_name@bldg2',
      '/facts/building_type@bldg2',
      '/facts/uses@bldg2',
    ])
    expect(operations.find((operation) => operation.path === '/unknowns')).toMatchObject({
      op: 'replace',
      value: ['gfa_above_ground@bldg1'],
    })
  })

  it('takes bldg1 without touching bldg10', () => {
    const before = profileWith({ 'building_type@bldg1': 'building', 'building_type@bldg10': 'building' })
    const planned = plan(before, { action: 'remove', buildingId: 'bldg1' })

    expect(Object.keys(planned.profile.facts)).toEqual(['country', 'building_type@bldg10'])
  })

  it('never removes the last building', () => {
    const one = profileWith({ 'building_type@bldg1': 'building' })

    expect(refusal(one, { action: 'remove', buildingId: 'bldg1' })).toBe(BUILDING_REFUSALS.lastBuilding)
    expect(refusal(emptyProjectProfile(), { action: 'remove', buildingId: 'bldg1' })).toBe(BUILDING_REFUSALS.lastBuilding)
  })

  it('refuses a building the profile does not describe', () => {
    expect(refusal(full(), { action: 'remove', buildingId: 'bldg9' })).toBe(BUILDING_REFUSALS.unknownBuilding)
  })
})
