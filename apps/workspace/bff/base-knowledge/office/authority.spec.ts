import { describe, expect, it } from 'vitest'
import { directiveApplicability, projectTerritory } from './authority'
import { AT_SUBDIVISIONS } from '@/lib/project-intake/at-setup.fixtures'

const MA37 = [{ name: 'MA 37', territoryId: 'AT-9' }]

describe('whether a directive belongs to the project’s building authority', () => {
  it('applies MA 37 to a project in Vienna', () => {
    expect(directiveApplicability(MA37, projectTerritory({ federalState: 'vienna' }, AT_SUBDIVISIONS))).toEqual({
      verdict: 'applies',
      authority: 'MA 37',
      territoryId: 'AT-9',
    })
  })

  it('does not apply MA 37 to a project in Graz', () => {
    expect(directiveApplicability(MA37, projectTerritory({ federalState: 'styria' }, AT_SUBDIVISIONS))).toEqual({
      verdict: 'does_not_apply',
      territoryId: 'AT-6',
    })
  })

  it('says the authority is unknown when the project’s Land is not recorded, or the directive names none', () => {
    expect(directiveApplicability(MA37, projectTerritory({}, AT_SUBDIVISIONS))).toEqual({ verdict: 'authority_unknown' })
    expect(directiveApplicability(MA37, projectTerritory({ federalState: 'outside_austria' }, AT_SUBDIVISIONS))).toEqual({
      verdict: 'authority_unknown',
    })
    expect(directiveApplicability([], projectTerritory({ federalState: 'vienna' }, AT_SUBDIVISIONS))).toEqual({ verdict: 'authority_unknown' })
  })

  it('knows no territory where no setup record is published: a Land token and a country alone place nothing', () => {
    expect(projectTerritory({ federalState: 'vienna' }, {})).toEqual({ territoryId: null, label: null })
    expect(projectTerritory({ country: 'at' }, {})).toEqual({ territoryId: null, label: null })
    expect(directiveApplicability(MA37, projectTerritory({ federalState: 'vienna' }, {}))).toEqual({ verdict: 'authority_unknown' })
    // Positive control: with Austria's records the same Land places the project.
    expect(projectTerritory({ federalState: 'vienna' }, AT_SUBDIVISIONS).territoryId).toBe('AT-9')
  })

  it('reads a country outside Austria as its own territory, where an Austrian authority does not decide', () => {
    expect(directiveApplicability(MA37, projectTerritory({ federalState: 'outside_austria', country: 'de' }, AT_SUBDIVISIONS))).toEqual({
      verdict: 'does_not_apply',
      territoryId: 'DE',
    })
  })
})
