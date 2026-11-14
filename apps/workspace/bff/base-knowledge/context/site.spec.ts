import { describe, expect, it } from 'vitest'
import { AT_SUBDIVISIONS } from '@/lib/project-intake/at-setup.fixtures'
import { siteLeaves, sitePlacement } from './site'

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

describe('what is recorded wins, then the office default (sitePlacement, ADR-0158)', () => {
  const VIENNA = 'AT-9'
  const at = (value: string, extra: Record<string, unknown> = {}) => ({ value, ...extra })
  /** Migration 0018's Land: an onboarding default with no evidence. */
  const onboardingDefault = at('vienna', { source: 'onboarding_default' })
  /** Migration 0201's or a typed address's postal-code Land: an onboarding default with its derivation. */
  const postalLand = at('tyrol', { source: 'onboarding_default', evidence: [{ kind: 'derivation', rule: 'postal_code' }] })
  const place = (profile: Parameters<typeof sitePlacement>[0]) => sitePlacement(profile, AT_SUBDIVISIONS, VIENNA)

  it('1. a confirmed fact, over every assumption, the only verified step', () => {
    expect(place({ facts: { federal_state: at('styria') }, assumptions: { federal_state: postalLand } })).toEqual({ step: 'fact', territoryId: 'AT-6' })
    expect(siteLeaves({ facts: { federal_state: at('styria') } }, AT_SUBDIVISIONS, VIENNA)[0]?.certainty).toBe('verified')
  })

  it('2. a recorded assumption: the postal-code Land, or a typed address’s country', () => {
    expect(place({ assumptions: { federal_state: postalLand, site_address: at('Herrengasse 16, 8010 Graz') } })).toEqual({ step: 'assumption', territoryId: 'AT-7' })
    expect(place({ assumptions: { country: at('de', { source: 'onboarding_default', evidence: [{ kind: 'person' }] }) } })).toEqual({ step: 'assumption', territoryId: 'DE' })
  })

  it('3. the Land the stored address names, over the onboarding default', () => {
    const profile = { facts: { site_address: at('Herrengasse 16, 8010 Graz') }, assumptions: { federal_state: onboardingDefault } }
    expect(place(profile)).toEqual({ step: 'address', territoryId: 'AT-6', token: 'styria' })
    expect(siteLeaves(profile, AT_SUBDIVISIONS, VIENNA)).toEqual([{ territoryId: 'AT-6', certainty: 'unverified' }])
  })

  it('4. the onboarding default where no address names a Land', () => {
    expect(place({ assumptions: { federal_state: onboardingDefault } })).toEqual({ step: 'onboarding_default', territoryId: 'AT-9' })
    expect(place({ assumptions: { federal_state: onboardingDefault, site_address: at('Somewhere without a code') } })?.step).toBe('onboarding_default')
  })

  it('5. the office’s default territory only where no place is recorded at all', () => {
    expect(place({})).toEqual({ step: 'office_default', territoryId: VIENNA })
    expect(place(null)).toEqual({ step: 'office_default', territoryId: VIENNA })
    expect(place({ assumptions: { site_address: at('Somewhere without a code') } })?.step).toBe('office_default')
    // An address naming another country is a place recorded: nothing assumes the office's home for it.
    expect(place({ facts: { site_address: at('Marienplatz 1, 80331 München, Deutschland') } })).toBeNull()
    expect(siteLeaves({}, AT_SUBDIVISIONS, VIENNA)).toEqual([{ territoryId: VIENNA, certainty: 'unverified' }])
  })

  it('places nothing without an office default, and never by default a project marked outside', () => {
    expect(sitePlacement({}, AT_SUBDIVISIONS, null)).toBeNull()
    expect(place({ facts: { federal_state: at('outside_austria') } })).toBeNull()
  })
})
