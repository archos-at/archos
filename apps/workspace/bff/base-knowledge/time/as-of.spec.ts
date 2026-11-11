/**
 * @vitest-environment node
 *
 * "What applied when this was submitted", answered with the edition named, on
 * the fixed as-of set (ADR-0171, ticket 30). Every case runs the real
 * evaluator (`decide` and `evaluateDecisionTable`), never a stub: the
 * reference-date rules and the transition are decision tables.
 */

import { describe, expect, it } from 'vitest'
import { transitionTableSchema } from '@/lib/base-knowledge/wire/time'
import { editionAsOf, editionForProcedure, type AsOfAnswer } from './as-of'
import {
  AS_OF_RULESETS,
  AS_OF_SET,
  NOW,
  OLD_LAW_IF_PENDING,
  WORKS,
  filingRule,
  parseProcedure,
  type AsOfCase,
} from './as-of-set.fixture'
import { editionInForce } from './editions'
import { dayIn, zoneOf } from './today'

function answer(
  testCase: AsOfCase,
  overrides: Partial<{ work: (typeof WORKS)[string] }> = {}
): AsOfAnswer {
  return editionForProcedure({
    work: overrides.work ?? WORKS[testCase.work],
    rulesets: testCase.rulesets ?? AS_OF_RULESETS,
    chain: testCase.chain,
    procedure: parseProcedure(testCase.procedure),
    facts: testCase.facts,
    now: NOW,
  })
}

/** The answer as the set's expectation reads it. */
function observed(result: AsOfAnswer): AsOfCase['expect'] {
  if (result.status === 'determined') return { edition: result.edition.label }
  if (result.status === 'choice')
    return { choice: [result.editions[0].label, result.editions[1].label] }
  if (result.reason === 'unknown_inputs') return { asks: result.unknownInputs }
  return { reason: result.reason }
}

const caseNamed = (prefix: string) =>
  AS_OF_SET.find((testCase) => testCase.name.startsWith(prefix)) as AsOfCase

describe('the fixed as-of set', () => {
  it.each(AS_OF_SET.map((testCase) => [testCase.name, testCase] as const))(
    '%s',
    (_name, testCase) => {
      expect(observed(answer(testCase))).toEqual(testCase.expect)
    }
  )

  it('names every edition the set expects, and the set decides most of its cases', () => {
    const determined = AS_OF_SET.filter((testCase) => 'edition' in testCase.expect)
    expect(determined.length).toBeGreaterThanOrEqual(8)
  })
})

describe('the answer carries what decided it', () => {
  it('positive control: the reference date, its rule and provision, and each boundary walked', () => {
    const result = answer(caseNamed('Wien: filed under the 2018'))
    expect(result).toMatchObject({
      status: 'determined',
      edition: { id: 'edition:fixture-wien-bo-2018', label: 'LGBl. 2018/37' },
      referenceDate: {
        date: '2023-06-01',
        event: 'filed_on',
        rulesetId: 'rule-at-9',
        territoryId: 'AT-9',
        provision: { citation: 'fixture: Stichtag AT-9' },
      },
      transitions: [
        {
          boundaryFrom: '2024-01-01',
          editionId: 'edition:fixture-wien-bo-2024',
          outcome: 'reference_date',
        },
      ],
    })
  })

  it('a transition step names its outcome and provision', () => {
    const result = answer(caseNamed('NÖ: filed before the boundary, decided after'))
    expect(result).toMatchObject({
      transitions: [
        { outcome: 'old_law', provision: { citation: 'fixture: Übergangsbestimmung' } },
      ],
    })
  })

  it('without a rule, shows the edition each known event gives, so both are in the answer', () => {
    const result = answer(caseNamed('Bayern: no own rule'))
    expect(result).toMatchObject({
      reason: 'no_reference_date_rule',
      candidates: [
        { event: 'filed_on', edition: { label: 'GVBl. 2021' } },
        { event: 'decided_on', edition: { label: 'GVBl. 2025' } },
      ],
    })
  })
})

describe('revert checks: take the data away and the answer moves', () => {
  it('the transition is what keeps the old law: a new_law table moves the answer to the new edition', () => {
    const testCase = caseNamed('NÖ: filed before the boundary, decided after')
    const newLaw = transitionTableSchema.parse({
      ...OLD_LAW_IF_PENDING,
      rows: [],
      otherwise: { then: 'new_law' },
    })
    const noe = WORKS.noe
    const work = {
      ...noe,
      editions: noe.editions.map((edition) =>
        edition.transition ? { ...edition, transition: newLaw } : edition
      ),
    }
    expect(observed(answer(testCase, { work }))).toEqual({ edition: 'LGBl. 2023/1' })
  })

  it('without the transition, the reference date decides the boundary', () => {
    const testCase = caseNamed('NÖ: filed after the boundary')
    const work = {
      ...WORKS.noe,
      editions: WORKS.noe.editions.map((edition) => ({ ...edition, transition: null })),
    }
    expect(observed(answer(testCase, { work }))).toEqual({ edition: 'LGBl. 2023/1' })
    expect(observed(answer(caseNamed('NÖ: decision unknown'), { work }))).toEqual({
      edition: 'LGBl. 1/2015',
    })
  })

  it('removing the node’s rule leaves no reference date, with no default', () => {
    const testCase = {
      ...caseNamed('Wien: filed under the 2018'),
      rulesets: AS_OF_RULESETS.filter((ruleset) => ruleset.id !== 'rule-at-9'),
    }
    expect(observed(answer(testCase))).toEqual({ reason: 'no_reference_date_rule' })
  })

  it('a rule not yet valid on the filing day does not decide', () => {
    const testCase = {
      ...caseNamed('Wien: filed under the 2018'),
      rulesets: [filingRule('rule-at-9-late', 'AT-9', { validFrom: '2025-01-01' })],
    }
    expect(observed(answer(testCase))).toEqual({ reason: 'no_reference_date_rule' })
  })
})

describe('fail closed on unknown', () => {
  it('an open procedure in a country with no zone listed does not take the server’s day', () => {
    const result = editionForProcedure({
      work: WORKS.wien,
      rulesets: [filingRule('rule-xx', 'XX')],
      chain: ['XX'],
      procedure: parseProcedure({ filedOn: '2023-06-01', decidedOn: 'pending' }),
      now: NOW,
    })
    expect(result).toEqual({ status: 'undetermined', reason: 'zone_unknown' })
  })

  it('an undated edition could be the one: the work is undetermined until it is dated', () => {
    const editions = [
      ...WORKS.wien.editions,
      { id: 'edition:x', label: 'undated', inForceFrom: null, inForceTo: null, transition: null },
    ]
    expect(editionInForce(editions, '2020-01-01', null)).toEqual({
      status: 'undetermined',
      reason: 'edition_dates_unknown',
      editionIds: ['edition:x'],
    })
  })

  it('two editions in force on one day are refused, not picked', () => {
    const editions = [
      ...WORKS.wien.editions,
      {
        id: 'edition:overlap',
        label: 'overlap',
        inForceFrom: '2020-01-01',
        inForceTo: null,
        transition: null,
      },
    ]
    expect(editionInForce(editions, '2020-06-01', null)).toMatchObject({
      reason: 'ambiguous_editions',
    })
  })

  it('a day after the last edition ended and before none began is no edition in force', () => {
    const editions = [
      {
        id: 'edition:old',
        label: 'old',
        inForceFrom: '2000-01-01',
        inForceTo: '2002-01-01',
        transition: null,
      },
    ]
    expect(editionInForce(editions, '2005-01-01', '2000-01-01')).toEqual({
      status: 'undetermined',
      reason: 'no_edition_in_force',
    })
  })

  it('the plain as-of answer for a date', () => {
    expect(editionAsOf(WORKS.wien, '2019-01-01')).toMatchObject({
      status: 'determined',
      edition: { label: 'LGBl. 2018/37' },
    })
    expect(editionAsOf(WORKS.wien, '2013-01-01')).toMatchObject({ reason: 'history_not_held' })
  })
})

describe('today in the node’s zone', () => {
  it('reads the country of a territory id', () => {
    expect([zoneOf('AT-9'), zoneOf('AT:gkz:90001'), zoneOf('DE'), zoneOf('XX')]).toEqual([
      'Europe/Vienna',
      'Europe/Vienna',
      'Europe/Berlin',
      null,
    ])
  })

  it('is the zone’s calendar day, not UTC’s', () => {
    expect(dayIn('Europe/Vienna', new Date('2026-12-31T23:30:00Z'))).toBe('2027-01-01')
  })
})

describe('the transition wire', () => {
  it('refuses a transition whose output is not old_law, new_law or choice', () => {
    const result = transitionTableSchema.safeParse({
      ...OLD_LAW_IF_PENDING,
      output: { type: 'code', codes: ['old_law', 'maybe'] },
    })
    expect(result.success).toBe(false)
  })
})

describe('the walk ends on an edition in force where it was reached (review findings)', () => {
  const decisionRule = filingRule('rule-decided', 'AT-9')
  const decidedRule = {
    ...decisionRule,
    values: {
      ...decisionRule.values,
      body: {
        kind: 'table' as const,
        payloadSchema: 'decision_table.v1' as const,
        payload: {
          inputs: [{ key: 'decided_on' as const, type: 'date' as const }],
          output: { type: 'event' as const, events: ['decided_on'] },
          rows: [{ id: 'decided', when: { '<=': ['0000-01-01', { var: 'decided_on' }] }, then: 'decided_on' }],
          otherwise: { undetermined: true as const },
          examples: [],
        },
      },
    },
  }
  const edition = (id: string, inForceFrom: string, inForceTo: string | null) => ({ id, label: id, inForceFrom, inForceTo, transition: null })
  const run = (editions: ReturnType<typeof edition>[], filedOn: string, decidedOn: string) =>
    editionForProcedure({
      work: { id: 'work:x', historyAvailableFrom: '2018-01-01', editions },
      rulesets: [decidedRule],
      chain: ['AT-9', 'AT'],
      procedure: parseProcedure({ filedOn, decidedOn }),
      now: NOW,
    })

  it('a repealed work has no edition on a reference date after its end', () => {
    expect(run([edition('A', '2018-01-01', '2022-01-01')], '2021-06-01', '2022-06-01')).toMatchObject({ reason: 'no_edition_in_force' })
  })

  it('a gap between editions on the reference date is no edition in force', () => {
    const editions = [edition('A', '2018-01-01', '2022-01-01'), edition('B', '2022-06-01', null)]
    expect(run(editions, '2021-06-01', '2022-03-01')).toMatchObject({ reason: 'no_edition_in_force' })
    // Positive control: decided once B is in force.
    expect(run(editions, '2021-06-01', '2022-07-01')).toMatchObject({ status: 'determined', edition: { id: 'B' } })
  })

  it('editions overlapping on the reference date are ambiguous, even when the walk started before the overlap', () => {
    const editions = [edition('A', '2018-01-01', null), edition('B', '2022-01-01', null)]
    expect(run(editions, '2021-06-01', '2023-01-01')).toMatchObject({ reason: 'ambiguous_editions', editionIds: ['A', 'B'] })
  })
})
