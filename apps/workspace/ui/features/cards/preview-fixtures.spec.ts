/**
 * @vitest-environment node
 */

import { describe, expect, it } from 'vitest'
import { CARD_INTERACTIVITY } from './card-decision'
import { CARD_PREVIEW_FIXTURES, PREVIEW_EXCLUDED, previewFixtureFor } from './preview-fixtures'

const ALL_TYPES = Object.keys(CARD_INTERACTIVITY)

describe('card preview fixtures', () => {
  it('covers every card type with a fixture or a stated exclusion', () => {
    const uncovered = ALL_TYPES.filter(
      (type) => !(type in CARD_PREVIEW_FIXTURES) && !(type in PREVIEW_EXCLUDED)
    )
    expect(uncovered).toEqual([])
  })

  it('excludes only types that exist, and previews nothing it excluded', () => {
    expect(Object.keys(PREVIEW_EXCLUDED).filter((type) => !ALL_TYPES.includes(type))).toEqual([])
    expect(Object.keys(PREVIEW_EXCLUDED).filter((type) => type in CARD_PREVIEW_FIXTURES)).toEqual([])
  })

  it('keeps every fixture valid against the live card union', () => {
    for (const [type, card] of Object.entries(CARD_PREVIEW_FIXTURES)) {
      expect(card?.type).toBe(type)
    }
    expect(Object.keys(CARD_PREVIEW_FIXTURES).length).toBe(ALL_TYPES.length - Object.keys(PREVIEW_EXCLUDED).length)
  })

  it('parsing fills the schema defaults an authored fixture omits', () => {
    const calculation = previewFixtureFor('calculation')
    expect(calculation).toMatchObject({ type: 'calculation' })
    expect(calculation).toHaveProperty('note', null)
  })

  it('returns undefined for a type it cannot preview', () => {
    expect(previewFixtureFor('ifc_viewer')).toBeUndefined()
    expect(previewFixtureFor('not_a_card')).toBeUndefined()
  })
})
