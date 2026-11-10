import { describe, expect, it } from 'vitest'
import { FEDERAL_STATE_TOKENS, COUNTRY_TOKENS } from '@/lib/project-profile/intake-conditions'
import { SITE_SUBDIVISIONS } from '@/lib/project-profile/intake-stages/project-basis'
import { setSitePlace, SITE_COUNTRIES } from './site-place-fields'

describe('the create form site picker', () => {
  it('offers the intake own tokens and no other', () => {
    expect([...SITE_COUNTRIES]).toEqual([...COUNTRY_TOKENS])
    expect([...SITE_SUBDIVISIONS.options.map((option) => option.token), SITE_SUBDIVISIONS.outside].sort()).toEqual([...FEDERAL_STATE_TOKENS].sort())
  })

  it('sends nothing for what was left empty, and a Land only in Austria', () => {
    const empty = new FormData()
    setSitePlace(empty, { country: '', federalState: '' })
    expect([...empty.keys()]).toEqual([])

    const austria = new FormData()
    setSitePlace(austria, { country: 'at', federalState: 'tyrol' })
    expect(Object.fromEntries(austria)).toEqual({ country: 'at', federal_state: 'tyrol' })

    const abroad = new FormData()
    setSitePlace(abroad, { country: 'de', federalState: 'tyrol' })
    expect(Object.fromEntries(abroad)).toEqual({ country: 'de' })
  })
})
