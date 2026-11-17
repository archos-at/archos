/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { evaluateIntakeCondition, findIntakeQuestion, flattenIntakeQuestions } from './intake-conditions'
import { answersFromProfile, buildIntakeProfile } from './intake-profile'
import { definition } from './intake-definition.fixtures'
import type { Answers } from './intake-definition.fixtures'

describe('projectIntakeDefinitionV1 shape', () => {
  it('starts with module A and carries the stable spec anchors', () => {
    expect(definition.stages[0].id).toBe('A')
    const ids = flattenIntakeQuestions(definition).map((q) => q.id)
    for (const anchor of [
      'A5',
      'C2',
      'CB1',
      'CB7_fn',
      'C8',
      'C10_text',
      'B3_stellplatz',
      'D0',
      'D_garagenfl',
    ]) {
      expect(ids).toContain(anchor)
    }
  })

  it('reveals the abbruch-only question F5 only when Abbruch is selected', () => {
    const f5 = findIntakeQuestion(definition, 'F5')!
    expect(evaluateIntakeCondition(f5, { A5: ['new_build'] })).toBe(false)
    expect(evaluateIntakeCondition(f5, { A5: ['new_build', 'demolition'] })).toBe(true)
  })

  it('marks exactly the konzept-required questions as required', () => {
    const required = flattenIntakeQuestions(definition)
      .filter((q) => q.required)
      .map((q) => q.id)
    expect(new Set(required)).toEqual(new Set(['A1', 'A2_adr', 'A2_country', 'A2_land', 'A5']))
  })
})

describe('v1.2 catalog shape', () => {
  it('carries the Schnellstart core path', () => {
    const core = flattenIntakeQuestions(definition)
      .filter((q) => q.core)
      .map((q) => q.id)
    expect(new Set(core)).toEqual(
      new Set([
        'A1',
        'A2_adr',
        'A2_country',
        'A2_land',
        'A4',
        'A5',
        'B1',
        'B1_text',
        'B2',
        'B2_upl',
        'C1',
        'C2',
        'CB3',
        'CB4',
        'C3',
        'C5',
        'C7',
        'D0',
        'DX1',
        'G1',
      ])
    )
  })

  it('marks the B-Plan extraction Kernset', () => {
    const kernset = flattenIntakeQuestions(definition)
      .filter((q) => q.kernset)
      .map((q) => q.id)
    expect(new Set(kernset)).toEqual(
      new Set(['B3_hoehe', 'B3_weise', 'B3_dichte', 'B3_flucht', 'B3_bes', 'B3_stellplatz'])
    )
  })

  it('dropped the v1.0-only questions', () => {
    const ids = new Set(flattenIntakeQuestions(definition).map((q) => q.id))
    for (const gone of [
      'A3',
      'A6',
      'A11',
      'B1_orig',
      'B6_tag',
      'B7_kanal',
      'B9',
      'C12',
      'E6',
      'F6',
      'G5',
    ]) {
      expect(ids.has(gone)).toBe(false)
    }
  })
})

describe('where a value is found, and what it feeds', () => {
  const questions = flattenIntakeQuestions(definition)
  const byId = (id: string) => {
    const question = findIntakeQuestion(definition, id)
    if (!question) throw new Error(`no question ${id}`)
    return question
  }

  it('names the documents of every core question in modules A to F that writes a key', () => {
    const coreWriters = definition.stages
      .filter((stage) => 'ABCDEF'.includes(stage.id))
      .flatMap((stage) => stage.questions)
      .filter((question) => question.core && question.writesTo)
    expect(coreWriters.length).toBeGreaterThan(10)
    for (const question of coreWriters) {
      expect(question.foundIn?.length, question.id).toBeGreaterThan(0)
    }
  })

  it('marks exactly the inputs of the building class as feeding it', () => {
    const feeding = questions
      .filter((question) => question.feeds === 'building_class')
      .map((question) => question.id)
    expect(feeding.sort()).toEqual(['C1', 'C3', 'C5', 'C6', 'C7', 'C8', 'C9', 'C9_zugang', 'D0'])
  })

  it('asks about access on three sides only for a freistehendes building, after the Gebäudestellung', () => {
    const ids = definition.stages
      .find((stage) => stage.id === 'C')!
      .questions.map((question) => question.id)
    expect(ids.indexOf('C9_zugang')).toBe(ids.indexOf('C9') + 1)
    const question = byId('C9_zugang')
    expect(question).toMatchObject({
      type: 'yes_no_open',
      writesTo: '/facts/access_three_sides/value',
    })

    const asked = (stellung: string) =>
      evaluateIntakeCondition(question, { 'C1@bldg1': 'building', 'C9@bldg1': stellung }, 'bldg1')
    expect(asked('freestanding')).toBe(true)
    expect(asked('attached')).toBe(false)
    expect(
      evaluateIntakeCondition(question, { 'C1@bldg1': 'small', 'C9@bldg1': 'freestanding' }, 'bldg1')
    ).toBe(false)
  })

  it('stores the access answer as a boolean fact and reads it back', () => {
    const answers: Answers = {
      'C1@bldg1': 'building',
      'C9@bldg1': 'freestanding',
      'C9_zugang@bldg1': 'yes',
    }
    const profile = buildIntakeProfile(answers, definition, {
      buildings: [{ id: 'bldg1', name: 'Haus' }],
    })
    expect(profile.facts['access_three_sides@bldg1']?.value).toBe(true)
    expect(answersFromProfile(profile, definition).answers['C9_zugang@bldg1']).toBe('yes')
  })

  it('defines the Fluchtniveau as the OIB does', () => {
    const hint = byId('C5').hint ?? ''
    expect(hint).toContain('höchstgelegenen oberirdischen Geschoßes')
    expect(hint).toContain('Geländeoberfläche nach Fertigstellung im Mittel')
    expect(hint).not.toContain('Aufenthaltsräumen')
    expect(hint).not.toContain('tiefsten Punkt')
  })
})
