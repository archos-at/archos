import { describe, expect, it } from 'vitest'
import { FEDERAL_STATE_TOKENS, COUNTRY_TOKENS } from '@/lib/project-profile/intake-conditions'
import { SITE_SUBDIVISIONS } from '@/lib/project-profile/intake-stages/project-basis'
import { setSitePlace, SITE_COUNTRIES } from './site-place-fields'

describe('the create form site picker', () => {
  it('offers the intake own tokens and no other', () => {
    expect([...SITE_COUNTRIES]).toEqual([...COUNTRY_TOKENS])
    expect([...SITE_SUBDIVISIONS.options.map((option) => option.token), SITE_SUBDIVISIONS.outside].sort()).toEqual([...FEDERAL_STATE_TOKENS].sort())
  })

  it('names every Land the record lists in German and in English, by its token', async () => {
    const [{ projects: de }, { projects: en }] = await Promise.all([import('@/i18n/dictionaries/de/projects'), import('@/i18n/dictionaries/en/projects')])
    for (const { token } of SITE_SUBDIVISIONS.options) {
      expect(de.form.site.state[token as keyof typeof de.form.site.state], `de ${token}`).toEqual(expect.any(String))
      expect(en.form.site.state[token as keyof typeof en.form.site.state], `en ${token}`).toEqual(expect.any(String))
    }
    expect(en.form.site.state.vienna).toBe('Vienna')
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
