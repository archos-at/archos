import { describe, expect, it } from 'vitest'
import { selectCapacityEvictions } from './capacity'

const ranked = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `l${i}` })) // l0 freshest

describe('selectCapacityEvictions', () => {
  it('an automatic promotion at the cap evicts the stalest lesson', () => {
    expect(selectCapacityEvictions(ranked(21), 20)).toEqual(['l20'])
  })

  it('below the cap evicts nothing', () => {
    expect(selectCapacityEvictions(ranked(20), 20)).toEqual([])
    expect(selectCapacityEvictions(ranked(20), 20, 'l5')).toEqual([])
  })

  it('never evicts the lesson an operator just activated, even when it is the stalest', () => {
    const active = ranked(21) // l20 is stalest and is the one just activated
    expect(selectCapacityEvictions(active, 20, 'l20')).toEqual(['l19'])
  })

  it('a protected lesson in the middle leaves the stalest other to go', () => {
    expect(selectCapacityEvictions(ranked(21), 20, 'l3')).toEqual(['l20'])
  })
})
