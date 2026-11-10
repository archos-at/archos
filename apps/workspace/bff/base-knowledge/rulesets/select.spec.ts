/**
 * @vitest-environment node
 *
 * Which ruleset decides for a site, and competence decided by one (ADR-0166).
 * The territories and authorities here are synthetic (`DE:test:…`,
 * `authority:test:…`): the real records arrive with the platform records slice,
 * and Austria's real competence rulesets with pack 1. Edge case E32 of the
 * design: in Berlin and Hamburg the Bezirksamt is the untere Bauaufsicht, read
 * from the site's city district.
 */

import { describe, expect, it } from 'vitest'
import { rulesetValuesSchema, type RulesetValuesInput } from '@/lib/base-knowledge/wire/ruleset'
import { RulesetEvaluationError } from './expression'
import { decide, selectRuleset, type StoredRuleset } from './select'

const ruleset = (id: string, values: RulesetValuesInput): StoredRuleset => ({
  id,
  values: rulesetValuesSchema.parse(values),
})

/** A Land whose building authority is the Bezirksamt of the site's city district. */
function districtCompetence(
  id: string,
  land: string,
  districts: Record<string, string>
): StoredRuleset {
  return ruleset(id, {
    purpose: 'competence',
    territoryIds: [land],
    validFrom: '2020-01-01',
    body: {
      kind: 'table',
      payloadSchema: 'decision_table.v1',
      payload: {
        inputs: [{ key: 'city_district', type: 'code' }],
        output: { type: 'bodies' },
        rows: Object.entries(districts).map(([district, authorityId], index) => ({
          id: `district-${index}`,
          when: { '===': [{ var: 'city_district' }, district] },
          then: { bodies: [{ authorityId, role: 'decides' }] },
          provision: { citation: 'synthetic: Bezirksamt als untere Bauaufsichtsbehörde' },
        })),
        otherwise: { undetermined: true },
      },
    },
  })
}

const BERLIN = districtCompetence('ruleset_test_berlin', 'DE-BE', {
  'DE:test:berlin-mitte': 'authority:test:bezirksamt-mitte',
  'DE:test:berlin-pankow': 'authority:test:bezirksamt-pankow',
})
const HAMBURG = districtCompetence('ruleset_test_hamburg', 'DE-HH', {
  'DE:test:hamburg-altona': 'authority:test:bezirksamt-altona',
})
const RULESETS = [BERLIN, HAMBURG]
const TODAY = '2026-11-10'

const competence = (chain: string[], facts: Record<string, unknown>) =>
  decide(RULESETS, { purpose: 'competence', chain, on: TODAY }, facts)

describe('E32: the Bezirksamt as untere Bauaufsicht, from a synthetic ruleset', () => {
  it('Berlin-Mitte: Bezirksamt Mitte decides, by the Land’s ruleset', () => {
    expect(
      competence(['DE:test:berlin-mitte', 'DE-BE', 'DE'], { city_district: 'DE:test:berlin-mitte' })
    ).toEqual({
      status: 'decided',
      rowId: 'district-0',
      then: { bodies: [{ authorityId: 'authority:test:bezirksamt-mitte', role: 'decides' }] },
      provision: { citation: 'synthetic: Bezirksamt als untere Bauaufsichtsbehörde' },
      rulesetId: 'ruleset_test_berlin',
      territoryId: 'DE-BE',
    })
  })

  it('Hamburg-Altona: Bezirksamt Altona decides', () => {
    expect(
      competence(['DE:test:hamburg-altona', 'DE-HH', 'DE'], {
        city_district: 'DE:test:hamburg-altona',
      })
    ).toMatchObject({
      status: 'decided',
      then: { bodies: [{ authorityId: 'authority:test:bezirksamt-altona', role: 'decides' }] },
      rulesetId: 'ruleset_test_hamburg',
    })
  })

  it('a Berlin site without its city district asks for exactly that', () => {
    expect(competence(['DE-BE', 'DE'], {})).toMatchObject({
      status: 'undetermined',
      reason: 'unknown_inputs',
      unknownInputs: ['city_district'],
    })
  })

  it('a district the ruleset does not list is undetermined, never another Bezirk’s office', () => {
    expect(
      competence(['DE:test:berlin-x', 'DE-BE', 'DE'], { city_district: 'DE:test:berlin-x' })
    ).toEqual({
      status: 'undetermined',
      reason: 'no_row_applies',
      rulesetId: 'ruleset_test_berlin',
      territoryId: 'DE-BE',
    })
  })

  it('a Land with no competence ruleset has no rule, and nothing stands in for it', () => {
    expect(competence(['DE:test:potsdam', 'DE-BB', 'DE'], { city_district: null })).toEqual({
      status: 'undetermined',
      reason: 'no_rule',
    })
  })
})

const referenceDate = (
  id: string,
  territoryId: string,
  extra: Partial<RulesetValuesInput> = {}
): StoredRuleset =>
  ruleset(id, {
    purpose: 'reference_date',
    territoryIds: [territoryId],
    validFrom: '2020-01-01',
    body: {
      kind: 'table',
      payloadSchema: 'decision_table.v1',
      payload: {
        inputs: [{ key: 'filed_on', type: 'date' }],
        output: { type: 'event', events: ['filed', 'decided'] },
        rows: [{ id: 'filed', when: { '<': [{ var: 'filed_on' }, '9999-12-31'] }, then: 'filed' }],
        otherwise: { undetermined: true },
      },
    },
    ...extra,
  })

describe('selecting the ruleset', () => {
  it('nearest: the deepest node with a ruleset decides', () => {
    const country = districtCompetence('country', 'DE', { x: 'authority:test:kreis' })
    expect(
      selectRuleset([country, BERLIN], { purpose: 'competence', chain: ['DE-BE', 'DE'], on: TODAY })
    ).toMatchObject({
      status: 'found',
      territoryId: 'DE-BE',
    })
    expect(
      selectRuleset([country], { purpose: 'competence', chain: ['DE-BE', 'DE'], on: TODAY })
    ).toMatchObject({ territoryId: 'DE' })
  })

  it('explicit: a reference date never borrows the parent’s rule unless the node says inherits: parent', () => {
    const federal = referenceDate('federal', 'DE')
    const query = { purpose: 'reference_date' as const, chain: ['DE-BY', 'DE'], on: TODAY }
    expect(selectRuleset([federal], query)).toEqual({ status: 'no_rule' })
    const inherits = ruleset('bavaria-inherits', {
      purpose: 'reference_date',
      territoryIds: ['DE-BY'],
      validFrom: '2020-01-01',
      body: { kind: 'inherits', inherits: 'parent' },
    })
    expect(selectRuleset([federal, inherits], query)).toMatchObject({
      status: 'found',
      territoryId: 'DE',
    })
  })

  it('takes validity as half-open: in force on validFrom, gone on validTo', () => {
    const dated = referenceDate('dated', 'AT', { validFrom: '2023-05-01', validTo: '2025-01-01' })
    const on = (date: string) =>
      selectRuleset([dated], { purpose: 'reference_date', chain: ['AT'], on: date }).status
    expect([on('2023-04-30'), on('2023-05-01'), on('2024-12-31'), on('2025-01-01')]).toEqual([
      'no_rule',
      'found',
      'found',
      'no_rule',
    ])
  })

  it('prefers a work-targeted ruleset for its works, and ignores it for others', () => {
    const general = referenceDate('general', 'DE')
    const baunvo = referenceDate('baunvo', 'DE', { workIds: ['work_baunvo'] })
    const query = { purpose: 'reference_date' as const, chain: ['DE'], on: TODAY }
    expect(selectRuleset([general, baunvo], { ...query, workId: 'work_baunvo' })).toMatchObject({
      ruleset: { id: 'baunvo' },
    })
    expect(selectRuleset([general, baunvo], { ...query, workId: 'work_baugb' })).toMatchObject({
      ruleset: { id: 'general' },
    })
    expect(selectRuleset([general, baunvo], query)).toMatchObject({ ruleset: { id: 'general' } })
  })

  it('refuses two rulesets for one node, purpose and date rather than picking one', () => {
    const twice = [referenceDate('a', 'DE'), referenceDate('b', 'DE')]
    expect(decide(twice, { purpose: 'reference_date', chain: ['DE'], on: TODAY }, {})).toEqual({
      status: 'undetermined',
      reason: 'ambiguous_rules',
      territoryId: 'DE',
      rulesetIds: ['a', 'b'],
    })
  })

  it('refuses a date that is not ISO rather than compare it as text', () => {
    expect(() =>
      selectRuleset(RULESETS, { purpose: 'competence', chain: ['DE-BE'], on: '10.11.2026' })
    ).toThrow(RulesetEvaluationError)
  })

  it('refuses a table for a purpose that has no decision table schema', () => {
    const result = rulesetValuesSchema.safeParse({ ...BERLIN.values, purpose: 'terminology' })
    expect(result.success).toBe(false)
  })
})
