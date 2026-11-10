import { describe, expect, it } from 'vitest'
import { directiveApplicability, projectTerritory } from './authority'

const MA37 = [{ name: 'MA 37', territoryId: 'AT-9' }]

describe('whether a directive belongs to the project’s building authority', () => {
  it('applies MA 37 to a project in Vienna', () => {
    expect(directiveApplicability(MA37, projectTerritory({ federalState: 'vienna' }))).toEqual({
      verdict: 'applies',
      authority: 'MA 37',
      territoryId: 'AT-9',
    })
  })

  it('does not apply MA 37 to a project in Graz', () => {
    expect(directiveApplicability(MA37, projectTerritory({ federalState: 'styria' }))).toEqual({
      verdict: 'does_not_apply',
      territoryId: 'AT-6',
    })
  })

  it('says the authority is unknown when the project’s Land is not recorded, or the directive names none', () => {
    expect(directiveApplicability(MA37, projectTerritory({}))).toEqual({
      verdict: 'authority_unknown',
    })
    expect(
      directiveApplicability(MA37, projectTerritory({ federalState: 'outside_austria' }))
    ).toEqual({
      verdict: 'authority_unknown',
    })
    expect(directiveApplicability([], projectTerritory({ federalState: 'vienna' }))).toEqual({
      verdict: 'authority_unknown',
    })
  })

  it('reads a country outside Austria as its own territory, where an Austrian authority does not decide', () => {
    expect(
      directiveApplicability(
        MA37,
        projectTerritory({ federalState: 'outside_austria', country: 'de' })
      )
    ).toEqual({
      verdict: 'does_not_apply',
      territoryId: 'DE',
    })
  })
})
