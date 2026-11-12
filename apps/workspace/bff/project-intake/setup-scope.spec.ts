/**
 * @vitest-environment node
 *
 * Each project receives its own country's setup records and no other's
 * (ADR-0169), and a project nothing places receives none.
 */

import { describe, expect, it } from 'vitest'
import { projectIntakeDefinitionV1 } from '@/lib/project-profile/intake-definition'
import { deriveAll, withDerivedClass } from './derivation-view'
import { planRecord } from './record'
import {
  buildingClassificationOf,
  factDefinitionsOf,
  factSourcesOf,
  hasSetupRecords,
  setupScopeOf,
  siteOfProfile,
  subdivisionTerritories,
} from './setup-scope'
import { AT_SETUP_RECORDS } from './at-setup.fixtures'
import { GERMAN_RECORDS, SWISS_RECORDS, THREE_COUNTRIES, placedProfile } from './setup-countries.fixtures'

const scope = (facts: Parameters<typeof placedProfile>[0], records = THREE_COUNTRIES) =>
  setupScopeOf(placedProfile(facts), { records, on: '2026-11-10' })

const subdivisionTokens = (facts: Parameters<typeof placedProfile>[0]) =>
  factDefinitionsOf(scope(facts))?.subdivisions?.options.map((option) => option.token) ?? []

describe('setupScopeOf', () => {
  it('places a project by its country and the subdivision that country lists', () => {
    expect(scope({ country: 'at', federal_state: 'vienna' }).chain).toEqual(['AT-9', 'AT'])
    expect(scope({ country: 'de', federal_state: 'bavaria' }).chain).toEqual(['DE-BY', 'DE'])
    expect(scope({ country: 'ch', federal_state: 'zurich' }).chain).toEqual(['CH-ZH', 'CH'])
    // A Land token from another country's list places no subdivision.
    expect(scope({ country: 'de', federal_state: 'vienna' }).chain).toEqual(['DE'])
  })

  it('places nothing for a project in no country, or in one it cannot name', () => {
    expect(scope({}).chain).toEqual([])
    expect(scope({ country: 'other' }).chain).toEqual([])
  })

  it('takes a geocoded subdivision only where exactly one country lists it', () => {
    const geocoded = (federalState: string) =>
      setupScopeOf(placedProfile({}), { records: THREE_COUNTRIES, on: '2026-11-10', location: { federalState } }).chain
    expect(geocoded('styria')).toEqual(['AT-6', 'AT'])
    expect(geocoded('bavaria')).toEqual(['DE-BY', 'DE'])
    expect(geocoded('atlantis')).toEqual([])
  })

  it('places nothing by a geocoded subdivision two countries list', () => {
    // Switzerland lists a `bavaria` too: which country the geocoder meant is the open question.
    const swissBavaria = SWISS_RECORDS.map((record) => {
      const { body } = record.values
      if (body.kind !== 'fact_definitions' || !body.payload.subdivisions) return record
      const subdivisions = body.payload.subdivisions
      const options = [...subdivisions.options, { token: 'bavaria', territoryId: 'CH-BV', label: 'Bavaria (CH)' }]
      return {
        ...record,
        values: { ...record.values, body: { ...body, payload: { ...body.payload, subdivisions: { ...subdivisions, options } } } },
      }
    })
    const records = [...AT_SETUP_RECORDS, ...GERMAN_RECORDS, ...swissBavaria]
    const geocoded = (federalState: string) =>
      setupScopeOf(placedProfile({}), { records, on: '2026-11-10', location: { federalState } }).chain
    expect(geocoded('bavaria')).toEqual([])
    // Positive control: a token only one country lists still places the project.
    expect(geocoded('berlin')).toEqual(['DE-BE', 'DE'])
  })
})

describe('only its own country’s options', () => {
  it('offers each project its own country’s subdivisions', () => {
    expect(subdivisionTokens({ country: 'at' })).toContain('vienna')
    expect(subdivisionTokens({ country: 'at' })).not.toContain('bavaria')
    expect(subdivisionTokens({ country: 'de' })).toEqual(['bavaria', 'berlin'])
    expect(subdivisionTokens({ country: 'ch' })).toEqual(['zurich'])
    expect(subdivisionTokens({})).toEqual([])
  })

  it('requests each project’s documents from its own country’s sources, the subdivision variant first', () => {
    const documents = (facts: Parameters<typeof placedProfile>[0]) =>
      factSourcesOf(scope(facts))?.entries.map((entry) => entry.request.document) ?? []
    expect(documents({ country: 'de' })).toEqual(['Auszug aus dem Bebauungsplan', 'Schnitt (DE)'])
    expect(documents({ country: 'ch' })).toEqual(['Grundbuchauszug (CH)'])
    expect(documents({ country: 'at' })).toContain('Grundbuchauszug')
    expect(documents({ country: 'other' })).toEqual([])
  })

  it('classifies a Building by its own country’s table, or not at all', () => {
    const building = { 'building_type@bldg1': 'building', 'storeys_above_ground@bldg1': 3 }
    const derived = (facts: Parameters<typeof placedProfile>[0]) =>
      deriveAll(placedProfile({ ...facts, ...building }), projectIntakeDefinitionV1, { records: THREE_COUNTRIES })
    const [german] = derived({ country: 'de' })
    expect(german).toMatchObject({ value: 3, citation: 'Synthetic MBO building class for a spec', missing: [] })
    const [austrian] = derived({ country: 'at' })
    expect(austrian.citation).toMatch(/^OIB-Richtlinien/)
    expect(austrian.missing).toContain('escape_level_m')
    expect(derived({ country: 'ch' })).toEqual([])
    expect(derived({})).toEqual([])
  })

  it('writes no class for a project whose country has no classification, and takes back a derived one', () => {
    const profile = placedProfile({ country: 'ch', 'building_type@bldg1': 'building' })
    profile.assumptions['building_class@bldg1'] = {
      value: 3,
      status: 'unconfirmed',
      reason: 'Abgeleitet: OIB',
      source: 'agent_suggested',
      updatedAt: '2026-11-10T00:00:00Z',
      evidence: [{ kind: 'derivation', rule: 'building_class', citation: 'OIB', inputs: [] }],
    }
    const result = withDerivedClass(profile, projectIntakeDefinitionV1, 'bldg1', '2026-11-10T00:00:00Z', {
      records: THREE_COUNTRIES,
    })
    expect(result.changed).toBe(true)
    expect(result.profile.assumptions['building_class@bldg1']).toBeUndefined()
  })

  it('refuses two classifications for one node rather than picking the first', () => {
    const [, classification] = GERMAN_RECORDS
    const twice = [...THREE_COUNTRIES, { ...classification, id: 'test:de-classification-2' }]
    expect(buildingClassificationOf(scope({ country: 'de' }, twice))).toBeNull()
    expect(buildingClassificationOf(scope({ country: 'de' }))).not.toBeNull()
  })
})

describe('siteOfProfile, for the BIM rules', () => {
  const records = THREE_COUNTRIES

  it('places, leaves unplaced, and reads a contradiction as unknown rather than as abroad', () => {
    expect(siteOfProfile(placedProfile({ country: 'at', federal_state: 'vienna' }), { records })).toEqual({ chain: ['AT-9', 'AT'] })
    expect(siteOfProfile(placedProfile({ country: 'other' }), { records })).toEqual({ chain: [] })
    expect(siteOfProfile(placedProfile({}), { records })).toBeNull()
    expect(siteOfProfile(placedProfile({ country: 'at', federal_state: 'outside_austria' }), { records })).toBeNull()
  })

  it('reads the geocoded Land the intake reads, where the profile states none', () => {
    // An Austrian project placed only by geocoding: without its Land every OIB rule stays open.
    expect(siteOfProfile(placedProfile({ country: 'at' }), { records, location: { federalState: 'styria' } })).toEqual({ chain: ['AT-6', 'AT'] })
    expect(siteOfProfile(placedProfile({}), { records, location: { federalState: 'styria' } })).toEqual({ chain: ['AT-6', 'AT'] })
    expect(siteOfProfile(placedProfile({ country: 'at' }), { records })).toEqual({ chain: ['AT'] })
    // A stated Land outranks the geocoder's.
    expect(siteOfProfile(placedProfile({ country: 'at', federal_state: 'vienna' }), { records, location: { federalState: 'styria' } })).toEqual({
      chain: ['AT-9', 'AT'],
    })
  })
})

describe('a site written by a reading', () => {
  const evidence = { kind: 'document' as const, fileName: 'Einreichplan.pdf', page: 1, quote: 'Bundesland: Wien' }
  const record = (profile: ReturnType<typeof placedProfile>, key: string, value: string) =>
    planRecord(profile, projectIntakeDefinitionV1, [{ key, screened: { key, value, evidence, reason: 'gelesen' }, refusal: null }], {
      now: '2026-11-10T00:00:00Z',
      readingId: 'job-1',
      needs: { mode: 'active', dismissed: [], records: THREE_COUNTRIES },
      records: THREE_COUNTRIES,
    })

  it('leaves a building’s class alone when the Land moves within Austria', () => {
    const profile = placedProfile({ country: 'at', 'building_type@bldg1': 'building', 'storeys_above_ground@bldg1': 3 })
    // A class a document stated, which the inputs on file would derive otherwise: a Land is no reason to touch it.
    profile.assumptions['building_class@bldg1'] = {
      value: 4,
      status: 'unconfirmed',
      reason: 'gelesen',
      source: 'agent_suggested',
      updatedAt: '2026-11-10T00:00:00Z',
    }
    const plan = record(profile, 'federal_state', 'vienna')
    expect(plan.profile.assumptions['building_class@bldg1']?.value).toBe(4)
    expect(plan.changedKeys).not.toContain('building_class@bldg1')
  })

  it('derives the classes once a site places the project in a country that classifies', () => {
    const building = {
      'building_type@bldg1': 'building',
      'building_position@bldg1': 'freestanding',
      'access_three_sides@bldg1': true,
      'storeys_above_ground@bldg1': 2,
      'escape_level_m@bldg1': 3.2,
      'gfa_above_ground@bldg1': 180,
      'use_units@bldg1': 1,
      'uses@bldg1': ['residential'],
    }
    const plan = record(placedProfile(building), 'country', 'at')
    expect(plan.profile.assumptions['building_class@bldg1']?.value).toBe(1)
    expect(plan.changedKeys).toContain('building_class@bldg1')
  })
})

describe('an edit before the country’s records are released', () => {
  const evidence = { kind: 'document' as const, fileName: 'Einreichplan.pdf', page: 1, quote: '3 Geschosse' }
  const building = {
    'building_type@bldg1': 'building',
    'building_position@bldg1': 'freestanding',
    'access_three_sides@bldg1': true,
    'storeys_above_ground@bldg1': 2,
    'escape_level_m@bldg1': 3.2,
    'gfa_above_ground@bldg1': 180,
    'use_units@bldg1': 1,
    'uses@bldg1': ['residential'],
  }
  const edit = (profile: ReturnType<typeof placedProfile>, records: typeof THREE_COUNTRIES) =>
    planRecord(
      profile,
      projectIntakeDefinitionV1,
      [{ key: 'storeys_above_ground@bldg1', screened: { key: 'storeys_above_ground@bldg1', value: 3, evidence, reason: 'gelesen' }, refusal: null }],
      { now: '2026-11-10T00:00:00Z', readingId: 'job-2', needs: { mode: 'active', dismissed: [], records }, records }
    )

  it('keeps a derived class while no record is released', () => {
    const derived = edit(placedProfile({ country: 'at', ...building }), THREE_COUNTRIES).profile
    expect(derived.assumptions['building_class@bldg1']).toBeDefined()
    const unpublished = edit(derived, [])
    expect(unpublished.profile.assumptions['building_class@bldg1']).toEqual(derived.assumptions['building_class@bldg1'])
    expect(unpublished.changedKeys).not.toContain('building_class@bldg1')
  })
})

describe('a country whose records are not published', () => {
  it('is placed in its country and nothing more: no subdivision, class or request stands in', () => {
    const none = (facts: Parameters<typeof placedProfile>[0]) => setupScopeOf(placedProfile(facts), { records: [], on: '2026-11-10' })
    expect(none({ country: 'at', federal_state: 'vienna' }).chain).toEqual(['AT'])
    expect(factDefinitionsOf(none({ country: 'at' }))).toBeNull()
    expect(factSourcesOf(none({ country: 'at' }))).toBeNull()
    expect(buildingClassificationOf(none({ country: 'at', federal_state: 'vienna' }))).toBeNull()
  })

  it('answers the one subdivision a record lists for a token, and none for a token without a record', () => {
    expect(subdivisionTerritories(THREE_COUNTRIES, '2026-11-10')).toMatchObject({ vienna: 'AT-9', bavaria: 'DE-BY', zurich: 'CH-ZH' })
    expect(subdivisionTerritories([], '2026-11-10')).toEqual({})
    expect(hasSetupRecords(THREE_COUNTRIES, 'DE', '2026-11-10')).toBe(true)
    expect(hasSetupRecords(AT_SETUP_RECORDS, 'DE', '2026-11-10')).toBe(false)
  })
})
