import { describe, expect, it } from 'vitest'
import { planName, replacedIndex, revisionByDefault } from './plan-index'

describe('planName', () => {
  it('reads a plan number and its letter index from the name', () => {
    expect(planName('S-101_D.pdf')).toEqual({ stem: 'S-101', index: 'D', extension: 'pdf' })
    expect(planName('FA-201_Ansicht_Ost_B.pdf')).toEqual({ stem: 'FA-201_Ansicht_Ost', index: 'B', extension: 'pdf' })
    expect(planName('TG-01 Index g.DWG')).toEqual({ stem: 'TG-01', index: 'G', extension: 'dwg' })
  })

  it('reads nothing from a name without a plan number, an index, or a plan format', () => {
    expect(planName('Statik_D.pdf')).toBeNull()
    expect(planName('S-101.pdf')).toBeNull()
    expect(planName('S-101_D.xlsx')).toBeNull()
    expect(planName('S-101_12.pdf')).toBeNull()
    expect(planName(null)).toBeNull()
  })
})

describe('revisionByDefault', () => {
  it('holds for the same plan number and format with the same or a later index', () => {
    expect(revisionByDefault('S-101_D.pdf', 'S-101_C.pdf')).toBe(true)
    expect(revisionByDefault('S-101 Index D.pdf', 'S-101_C.pdf')).toBe(true)
    expect(revisionByDefault('S-101_D.pdf', 'S-101_D.pdf')).toBe(true)
  })

  it('does not hold for an older index, another number, another format or a name without an index', () => {
    expect(revisionByDefault('S-101_B.pdf', 'S-101_C.pdf')).toBe(false)
    expect(revisionByDefault('S-102_D.pdf', 'S-101_C.pdf')).toBe(false)
    expect(revisionByDefault('S-101_D.dwg', 'S-101_C.pdf')).toBe(false)
    expect(revisionByDefault('S-101.pdf', 'S-101_C.pdf')).toBe(false)
  })
})

describe('replacedIndex', () => {
  it('names the index the next Fassung replaces, and nothing when the names carry the same one', () => {
    expect(replacedIndex('S-101_D.pdf', 'S-101_C.pdf')).toBe('C')
    expect(replacedIndex('S-101_D.pdf', 'S-101_D.pdf')).toBeNull()
    expect(replacedIndex('Bewehrung.pdf', 'Bewehrung_alt.pdf')).toBeNull()
  })
})
