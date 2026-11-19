import { describe, expect, it } from 'vitest'
import { indexChange, planName, planNamePattern, revisionByDefault, revisionCandidateOf } from './plan-index'

describe('planName', () => {
  it('reads a plan number and one letter index after `_` or `-`', () => {
    expect(planName('S-101_D.pdf')).toEqual({ stem: 'S-101', index: 'D', extension: 'pdf' })
    expect(planName('S-101-d.PDF')).toEqual({ stem: 'S-101', index: 'D', extension: 'pdf' })
    expect(planName('FA-201_Ansicht_Ost_B.pdf')).toEqual({ stem: 'FA-201_Ansicht_Ost', index: 'B', extension: 'pdf' })
  })

  it('reads nothing where the naming is not unmistakable: no number, no single letter, another separator, no plan format', () => {
    expect(planName('Statik_D.pdf')).toBeNull()
    expect(planName('S-101.pdf')).toBeNull()
    expect(planName('S-101_D.xlsx')).toBeNull()
    expect(planName('S-101_12.pdf')).toBeNull()
    expect(planName('S-101_DE.pdf')).toBeNull()
    expect(planName('S-101 D.pdf')).toBeNull()
    expect(planName('S-101.D.pdf')).toBeNull()
    expect(planName('TG-01 Index G.dwg')).toBeNull()
    expect(planName(null)).toBeNull()
  })
})

describe('revisionByDefault', () => {
  it('holds for the same plan number and format with the same or a later index', () => {
    expect(revisionByDefault('S-101_D.pdf', 'S-101_C.pdf')).toBe(true)
    expect(revisionByDefault('s-101-D.pdf', 'S-101_C.pdf')).toBe(true)
    expect(revisionByDefault('S-101_D.pdf', 'S-101_D.pdf')).toBe(true)
  })

  it('does not hold for an older index, another number, another format or a name that is no clear plan', () => {
    expect(revisionByDefault('S-101_B.pdf', 'S-101_C.pdf')).toBe(false)
    expect(revisionByDefault('S-102_D.pdf', 'S-101_C.pdf')).toBe(false)
    expect(revisionByDefault('S-101_D.dwg', 'S-101_C.pdf')).toBe(false)
    expect(revisionByDefault('S 101_D.pdf', 'S-101_C.pdf')).toBe(false)
    expect(revisionByDefault('S-101 Index D.pdf', 'S-101_C.pdf')).toBe(false)
  })
})

describe('indexChange', () => {
  it('names the plan and both indexes when one plan arrives in another index', () => {
    expect(indexChange('S-101_D.pdf', 'S-101_C.pdf')).toEqual({ plan: 'S-101', from: 'C', to: 'D' })
  })

  it('names nothing for the same index, another plan, or a name without an index on either side', () => {
    expect(indexChange('S-101_D.pdf', 'S-101_D.pdf')).toBeNull()
    expect(indexChange('S-102_D.pdf', 'S-101_C.pdf')).toBeNull()
    expect(indexChange('S-101.pdf', 'S-101_C.pdf')).toBeNull()
    expect(indexChange('S-101_D.pdf', 'S-101.pdf')).toBeNull()
    expect(indexChange('Bewehrung.pdf', 'Bewehrung_alt.pdf')).toBeNull()
  })
})

describe('planNamePattern', () => {
  it('matches the plan number, two characters and the format, its own wildcards escaped', () => {
    expect(planNamePattern({ stem: 'S-101', index: 'D', extension: 'pdf' })).toBe('s-101__.pdf')
    expect(planNamePattern({ stem: 'FA_5%', index: 'B', extension: 'dwg' })).toBe('fa\\_5\\%__.dwg')
  })
})

describe('revisionCandidateOf', () => {
  const doc = (id: string, filename: string) => ({ id, filename })

  it('takes a document of the same name first', () => {
    expect(revisionCandidateOf('S-101_D.pdf', [doc('c', 'S-101_C.pdf'), doc('d', 'S-101_D.pdf')])?.id).toBe('d')
  })

  it('else takes the same plan number with the latest earlier index, the newest of equals', () => {
    const documents = [doc('b', 'S-101_B.pdf'), doc('c-new', 'S-101-C.pdf'), doc('c-old', 'S-101_C.pdf'), doc('a', 'S-101_A.pdf')]
    expect(revisionCandidateOf('S-101_D.pdf', documents)?.id).toBe('c-new')
  })

  it('takes nothing in doubt: a later index, another number or format, a looser name, or a file that is no clear plan', () => {
    expect(revisionCandidateOf('S-101_C.pdf', [doc('d', 'S-101_D.pdf')])).toBeNull()
    expect(revisionCandidateOf('S-101_D.pdf', [doc('x', 'S-102_C.pdf'), doc('y', 'S-101_C.dwg'), doc('z', 'S-101 Index C.pdf')])).toBeNull()
    expect(revisionCandidateOf('S-101 Index D.pdf', [doc('c', 'S-101_C.pdf')])).toBeNull()
    expect(revisionCandidateOf('Bescheid.pdf', [doc('z', 'Bescheid_alt.pdf')])).toBeNull()
  })
})
