import { describe, expect, it } from 'vitest'
import { AT_SUBDIVISIONS } from '@/lib/project-intake/at-setup.fixtures'
import { siteLeaves } from './site'

const entry = (value: string) => ({ value })

describe('the site leaves of a profile, with the Länder the released records list', () => {
  it('places a project in the Land a record lists for its token, then in the country', () => {
    expect(siteLeaves({ facts: { federal_state: entry('styria') } }, AT_SUBDIVISIONS)).toEqual([{ territoryId: 'AT-6', certainty: 'verified' }])
    expect(siteLeaves({ assumptions: { federal_state: entry('vienna') } }, AT_SUBDIVISIONS)).toEqual([{ territoryId: 'AT-9', certainty: 'unverified' }])
    expect(siteLeaves({ facts: { country: entry('de') } }, AT_SUBDIVISIONS)).toEqual([{ territoryId: 'DE', certainty: 'verified' }])
  })

  it('places a Land token no published record lists nowhere, rather than in Austria', () => {
    expect(siteLeaves({ facts: { federal_state: entry('styria') } }, {})).toEqual([])
    // The country the profile states still places it.
    expect(siteLeaves({ facts: { federal_state: entry('styria'), country: entry('at') } }, {})).toEqual([{ territoryId: 'AT', certainty: 'verified' }])
  })

  it('prefers the register’s municipality to the stated Land', () => {
    expect(siteLeaves({ facts: { site_territory: entry('AT:gkz:60101'), federal_state: entry('vienna') } }, AT_SUBDIVISIONS)).toEqual([
      { territoryId: 'AT:gkz:60101', certainty: 'verified' },
    ])
  })
})
