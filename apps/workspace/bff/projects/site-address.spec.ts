import { describe, expect, test } from 'vitest'
import type { Project } from '@/lib/db/schema/projects'
import { projectSiteAddress } from './site-address'

// The legacy fact key is stored data, not a name of ours (migration 0159).
const LEGACY_ADDRESS_KEY = 'standort_adresse'

const withFacts = (facts: Record<string, unknown>): Pick<Project, 'profile'> => ({
  profile: {
    facts: Object.fromEntries(
      Object.entries(facts).map(([key, value]) => [
        key,
        { value, confidence: 'confirmed', source: 'onboarding', updatedAt: '2026-07-01T00:00:00Z' },
      ]),
    ) as Project['profile']['facts'],
    goals: {},
    unknowns: [],
    assumptions: {},
  },
})

describe('projectSiteAddress', () => {
  test('reads the profile fact site_address, trimmed', () => {
    expect(projectSiteAddress(withFacts({ site_address: '  Erdberger Lände 3, 1030 Wien ' }))).toBe(
      'Erdberger Lände 3, 1030 Wien',
    )
  })

  test('falls back to the key an older pod still writes (migration 0159)', () => {
    expect(projectSiteAddress(withFacts({ [LEGACY_ADDRESS_KEY]: 'Stiftsplatz 1, 3400 Klosterneuburg' }))).toBe(
      'Stiftsplatz 1, 3400 Klosterneuburg',
    )
  })

  test('is null when there is no address, a blank one, or not a string', () => {
    expect(projectSiteAddress(withFacts({}))).toBeNull()
    expect(projectSiteAddress(withFacts({ site_address: '   ' }))).toBeNull()
    expect(projectSiteAddress(withFacts({ site_address: 42 }))).toBeNull()
    expect(projectSiteAddress({ profile: null as unknown as Project['profile'] })).toBeNull()
  })
})
