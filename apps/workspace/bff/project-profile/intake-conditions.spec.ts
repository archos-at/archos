/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { answerKeyFor, modeKeyFor } from './intake-building-keys'
import {
  COUNTRY_TOKENS,
  FEDERAL_STATE_TOKENS,
  evaluateIntakeCondition,
  findIntakeQuestion,
  flattenIntakeQuestions,
  isValidCountryToken,
  isValidFederalStateToken,
  pruneStaleConditionalAnswers,
} from './intake-conditions'
import { definition } from './intake-definition.fixtures'

describe('pruneStaleConditionalAnswers', () => {
  it('drops a conditional answer once its condition no longer holds', () => {
    const pruned = pruneStaleConditionalAnswers(
      { 'C2@bldg1': 'new_build', 'CB1@bldg1': 1962, [modeKeyFor('CB1@bldg1')]: 'value' },
      definition
    )
    expect(pruned['CB1@bldg1']).toBeUndefined()
    expect(pruned[modeKeyFor('CB1@bldg1')]).toBeUndefined()
    expect(pruned['C2@bldg1']).toBe('new_build')
  })

  it('keeps a conditional answer whose condition still holds', () => {
    const answers = { 'C2@bldg1': 'existing', 'CB1@bldg1': 1962, [modeKeyFor('CB1@bldg1')]: 'value' }
    const pruned = pruneStaleConditionalAnswers(answers, definition)
    expect(pruned['CB1@bldg1']).toBe(1962)
  })

  it('prunes a building-scope conditional within its instance', () => {
    const pruned = pruneStaleConditionalAnswers(
      { 'C1@bldg1': 'small', 'C3@bldg1': 3, [modeKeyFor('C3@bldg1')]: 'value' },
      definition
    )
    expect(pruned['C3@bldg1']).toBeUndefined()
    expect(pruned['C1@bldg1']).toBe('small')
  })

  it('leaves unconditional and unrelated answers untouched', () => {
    const answers = { A2_country: 'at', A2_land: 'vienna', A5: ['new_build'] }
    const pruned = pruneStaleConditionalAnswers(answers, definition)
    expect(pruned).toEqual(answers)
    expect(pruned).toBe(answers)
  })

  it('is a no-op when the definition is missing', () => {
    const answers = { A5: ['new_build'], 'CB1@bldg1': 1962 }
    expect(pruneStaleConditionalAnswers(answers, null)).toBe(answers)
  })
})

describe('evaluateIntakeCondition', () => {
  it('handles includes_any against a building-scope multi-select', () => {
    const cb6 = findIntakeQuestion(definition, 'CB6')!
    const base = { 'C2@bldg1': 'existing' }
    expect(evaluateIntakeCondition(cb6, { ...base, 'CB4@bldg1': ['interior_conversion'] }, 'bldg1')).toBe(false)
    expect(evaluateIntakeCondition(cb6, { ...base, 'CB4@bldg1': ['core_refurbishment'] }, 'bldg1')).toBe(
      true
    )
  })

  it('asks for the federal state while the country is open or Austria, never elsewhere', () => {
    const land = findIntakeQuestion(definition, 'A2_land')!
    expect(evaluateIntakeCondition(land, {})).toBe(true)
    expect(evaluateIntakeCondition(land, { A2_country: 'at' })).toBe(true)
    for (const country of ['de', 'ch', 'other']) {
      expect(evaluateIntakeCondition(land, { A2_country: country })).toBe(false)
    }
  })

  it('resolves a building-scope param within the current instance', () => {
    const c3 = findIntakeQuestion(definition, 'C3')!
    expect(evaluateIntakeCondition(c3, { 'C1@bldg1': 'building' }, 'bldg1')).toBe(true)
    expect(evaluateIntakeCondition(c3, { 'C1@bldg1': 'small' }, 'bldg1')).toBe(false)
  })

  it('answerKeyFor composes scope instance keys', () => {
    expect(answerKeyFor('C3', 'bldg1')).toBe('C3@bldg1')
    expect(answerKeyFor('D_we', 'bldg2', 'residential')).toBe('D_we@bldg2@residential')
  })

  describe('lte (the C8 gate)', () => {
    const c8 = findIntakeQuestion(definition, 'C8')!
    const building = { 'C1@bldg1': 'building' }

    it('is satisfied below the bound, not only AT it', () => {
      for (const storeys of [3, 4]) {
        expect(
          evaluateIntakeCondition(
            c8,
            { ...building, 'C3@bldg1': storeys, [modeKeyFor('C3@bldg1')]: 'value' },
            'bldg1'
          )
        ).toBe(true)
      }
      expect(
        evaluateIntakeCondition(
          c8,
          { ...building, 'C3@bldg1': 5, [modeKeyFor('C3@bldg1')]: 'value' },
          'bldg1'
        )
      ).toBe(false)
    })

    it('an estimate can satisfy it, an explicitly open value cannot', () => {
      expect(
        evaluateIntakeCondition(
          c8,
          { ...building, 'C3@bldg1': 3, [modeKeyFor('C3@bldg1')]: 'estimated' },
          'bldg1'
        )
      ).toBe(true)
      expect(
        evaluateIntakeCondition(c8, { ...building, [modeKeyFor('C3@bldg1')]: 'open' }, 'bldg1')
      ).toBe(false)
    })

    it('an absent storey count never reveals the question', () => {
      expect(evaluateIntakeCondition(c8, building, 'bldg1')).toBe(false)
    })
  })
})

describe('FEDERAL_STATE_TOKENS / isValidFederalStateToken', () => {
  it('contains exactly the nine federal state tokens plus ausserhalb_oesterreichs', () => {
    expect(new Set(FEDERAL_STATE_TOKENS)).toEqual(
      new Set([
        'vienna',
        'lower_austria',
        'upper_austria',
        'styria',
        'carinthia',
        'salzburg',
        'tyrol',
        'vorarlberg',
        'burgenland',
        'outside_austria',
      ])
    )
  })

  it('stays byte-identical to the A2_land question options (single source of truth)', () => {
    const question = flattenIntakeQuestions(definition).find((q) => q.id === 'A2_land')!
    expect(FEDERAL_STATE_TOKENS).toEqual(question.options?.map((option) => option.value))
  })

  it('isValidFederalStateToken accepts every known token', () => {
    for (const token of FEDERAL_STATE_TOKENS) {
      expect(isValidFederalStateToken(token)).toBe(true)
    }
  })

  it('isValidFederalStateToken rejects unknown/malformed tokens', () => {
    expect(isValidFederalStateToken('atlantis')).toBe(false)
    expect(isValidFederalStateToken('')).toBe(false)
    expect(isValidFederalStateToken('Wien')).toBe(false)
  })
})

describe('COUNTRY_TOKENS / isValidCountryToken', () => {
  it('contains the four country options', () => {
    expect(COUNTRY_TOKENS).toEqual(['at', 'de', 'ch', 'other'])
  })

  it('accepts recognized country tokens', () => {
    expect(isValidCountryToken('at')).toBe(true)
    expect(isValidCountryToken('de')).toBe(true)
    expect(isValidCountryToken('ch')).toBe(true)
    expect(isValidCountryToken('other')).toBe(true)
  })

  it('rejects unknown country tokens', () => {
    expect(isValidCountryToken('fr')).toBe(false)
    expect(isValidCountryToken('')).toBe(false)
    expect(isValidCountryToken('AT')).toBe(false)
  })
})
