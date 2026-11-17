/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { findIntakeQuestion } from './intake-conditions'
import { formatIntakeAnswer, humanizeProfileKey, labelForProfileKey, validateProfilePatchVocabulary } from './intake-vocabulary'
import type { ProjectProfilePatchOperation } from './types'
import { definition } from './intake-definition.fixtures'

describe('formatIntakeAnswer', () => {
  const landQuestion = findIntakeQuestion(definition, 'A2_land')!

  it('renders option labels rather than raw values', () => {
    expect(formatIntakeAnswer(landQuestion, 'vienna')).toBe('Wien')
  })

  it('renders a dash for missing answers', () => {
    expect(formatIntakeAnswer(landQuestion, undefined)).toBe('—')
  })

  it('appends the unit for a number_tri answer', () => {
    const c4 = findIntakeQuestion(definition, 'C5')!
    expect(formatIntakeAnswer(c4, 9)).toBe('9 m')
  })
})

describe('labelForProfileKey', () => {
  it('maps a raw fact key back to its intake question label', () => {
    expect(labelForProfileKey(definition, 'escape_level_m')).toBe('Fluchtniveau (Zielzustand)')
    expect(labelForProfileKey(definition, 'federal_state')).toBe('Bundesland')
  })

  it('resolves a scoped key by its base', () => {
    expect(labelForProfileKey(definition, 'storeys_above_ground@bldg1')).toBe(
      'Anzahl oberirdischer Geschoße (Zielzustand)'
    )
  })

  it('falls back to a title-cased humanization for genuinely unknown keys', () => {
    expect(labelForProfileKey(definition, 'some_unmapped_key')).toBe('Some Unmapped Key')
  })
})

describe('humanizeProfileKey', () => {
  it('title-cases snake_case keys and strips a scope suffix', () => {
    expect(humanizeProfileKey('development_plan_notes')).toBe('Development Plan Notes')
    expect(humanizeProfileKey('escape_level_m@bldg1')).toBe('Escape Level M')
  })
})

describe('validateProfilePatchVocabulary', () => {
  const validate = (op: ProjectProfilePatchOperation['op'], path: string, value?: unknown) =>
    validateProfilePatchVocabulary([{ op, path, value }])

  it('accepts an allowed single-select value', () => {
    expect(() => validate('add', '/facts/building_type', 'building')).not.toThrow()
  })

  it('rejects a single-select value outside the options', () => {
    expect(() => validate('add', '/facts/building_type', 'nope')).toThrow(/Bauwerkstyp/)
  })

  it('rejects a federal state outside the vocabulary', () => {
    expect(() => validate('add', '/facts/federal_state', 'bayern')).toThrow(/Bundesland/)
    expect(() => validate('add', '/facts/federal_state', 'vienna')).not.toThrow()
    expect(() => validate('add', '/facts/federal_state', 'outside_austria')).not.toThrow()
  })

  it('rejects a non-boolean for a yes_no_open fact', () => {
    expect(() => validate('add', '/facts/heritage_protection', 'yes')).toThrow(/Denkmalschutz/)
  })

  it('accepts a finite number for a number_tri fact', () => {
    expect(() => validate('add', '/facts/storeys_above_ground', 3)).not.toThrow()
  })

  it('resolves a scoped key by its base', () => {
    expect(() => validate('add', '/facts/storeys_above_ground@bldg1', 3)).not.toThrow()
    expect(() => validate('add', '/facts/building_type@bldg1', 'nope')).toThrow(/Bauwerkstyp/)
  })

  it('lets unknown keys through — the model may record novel facts', () => {
    expect(() => validate('add', '/facts/some_novel_fact', 'anything')).not.toThrow()
  })

  it('validates a shaped { value } op the same as a bare value', () => {
    expect(() =>
      validate('add', '/facts/building_type', {
        value: 'nope',
        confidence: 'confirmed',
        source: 'user_confirmed',
        updatedAt: '2026-07-08T00:00:00.000Z',
      })
    ).toThrow(/Bauwerkstyp/)
  })

  it('validates the deep /facts/<key>/value path form', () => {
    expect(() => validate('add', '/facts/building_type/value', 'nope')).toThrow(/Bauwerkstyp/)
  })

  it('always passes remove operations', () => {
    expect(() => validate('remove', '/facts/building_type')).not.toThrow()
  })

  it('rejects a multi-select value outside the options', () => {
    expect(() => validate('add', '/facts/work_type', ['new_build', 'nope'])).toThrow(
      /Art des Vorhabens/
    )
  })
})
