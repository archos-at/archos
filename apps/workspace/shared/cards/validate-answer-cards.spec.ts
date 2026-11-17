/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest'
import { validateAnswerCards } from './schemas'

const CALCULATION = {
  type: 'calculation',
  title: 'Schrittmaßregel – Treppenlauf Haus A',
  steps: [
    {
      label: 'Schrittmaß',
      operation: 'sum',
      unit: 'cm',
      operands: [
        { label: 'Steigung', value: 17, unit: 'cm', factor: 2 },
        { label: 'Auftritt', value: 30, unit: 'cm' },
      ],
    },
  ],
  reference: { document: 'OIB-Richtlinie 4', section: 'Pkt. 2.2' },
}

const PROPOSAL = { type: 'memory_proposal', title: 'Merken?', content: 'REI 90 bei GK 4.', kind: 'preference' }

const PATCH = {
  type: 'project_profile_patch',
  title: 'Fluchtniveau aktualisieren',
  rationale: 'Das Fluchtniveau liegt bei 25 m.',
  patch: [{ op: 'add', path: '/facts/escape_level', value: '>22m' }],
}

describe('a card the union knows keeps every card after it in place', () => {
  it('validates a calculation rather than dropping it', () => {
    const cards = validateAnswerCards([CALCULATION])

    expect(cards).toHaveLength(1)
    expect(cards[0]?.type).toBe('calculation')
  })

  it('leaves the cards after a calculation at the index their marker names', () => {
    const cards = validateAnswerCards([CALCULATION, PROPOSAL, PATCH])

    expect(cards.map((card) => card?.type)).toEqual(['calculation', 'memory_proposal', 'project_profile_patch'])
  })
})

describe('a card the union rejects leaves a hole, not a shift', () => {
  it('keeps the wire length and the positions after the gap', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const cards = validateAnswerCards([{ type: 'not_a_card_type' }, PROPOSAL, PATCH])

      expect(cards).toHaveLength(3)
      expect(cards[0]).toBeUndefined()
      expect(cards[1]?.type).toBe('memory_proposal')
      expect(cards[2]?.type).toBe('project_profile_patch')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('holds the middle when the middle card is the one that fails', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const cards = validateAnswerCards([PROPOSAL, { type: 'not_a_card_type' }, PATCH])

      expect(cards.map((card) => card?.type)).toEqual(['memory_proposal', undefined, 'project_profile_patch'])
    } finally {
      warn.mockRestore()
    }
  })

  it('returns no cards for a non-array, and holes for nothing else', () => {
    expect(validateAnswerCards(undefined)).toEqual([])
    expect(validateAnswerCards(null)).toEqual([])
    expect(validateAnswerCards({ type: 'memory_proposal' })).toEqual([])
  })
})
