import { describe, expect, it } from 'vitest'
import { placedOutsideAustria, siteCountry } from './site'
import type { ProjectProfile } from './types'

const fact = (value: string) => ({ value, confidence: 'confirmed' as const, source: 'onboarding' as const, updatedAt: '' })
const assumed = (value: string) => ({
  value,
  status: 'unconfirmed' as const,
  reason: 'r',
  source: 'agent_suggested' as const,
  updatedAt: '',
})

function profile(facts: Record<string, string>, assumptions: Record<string, string> = {}): Pick<ProjectProfile, 'facts' | 'assumptions'> {
  return {
    facts: Object.fromEntries(Object.entries(facts).map(([key, value]) => [key, fact(value)])),
    assumptions: Object.fromEntries(Object.entries(assumptions).map(([key, value]) => [key, assumed(value)])),
  }
}

// The twin of `agent.common.country_profile.resolve_site` (packages/agent/tests/common/test_country_profile.py).
describe('siteCountry', () => {
  it.each([
    [profile({ country: 'at', federal_state: 'tyrol' }), 'at'],
    [profile({ federal_state: 'vienna' }), 'at'],
    [profile({ country: 'de' }), 'de'],
    [profile({ country: 'other' }), 'other'],
    [profile({ federal_state: 'outside_austria' }), 'other'],
    [profile({}, { federal_state: 'vienna' }), 'at'],
    [profile({ country: 'de' }, { federal_state: 'vienna' }), 'de'],
    [profile({ main_use: 'residential' }), null],
  ])('places %j in %s', (input, expected) => {
    expect(siteCountry(input)).toBe(expected)
  })

  it('is outside Austria only for a placed project, never for an unplaced one', () => {
    expect(placedOutsideAustria(profile({ country: 'ch' }))).toBe(true)
    expect(placedOutsideAustria(profile({ country: 'at' }))).toBe(false)
    expect(placedOutsideAustria(profile({}))).toBe(false)
  })
})
