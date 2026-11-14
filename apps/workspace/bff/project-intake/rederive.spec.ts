/**
 * @vitest-environment node
 *
 * The one-time derivation after a release (`rederive.ts`): the office's assumed territory comes from the
 * home country's record, the site the knowledge context places a project by is recorded, a class is derived
 * from the released records, and nothing is written where nothing moves or law is withheld.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyProjectProfile } from '@/lib/project-profile/patch-engine'
import { ASSUMED_SITE_REASON, isOfficeDefault, withAssumedSite } from '@/lib/project-profile/site'
import { factDefinitionsSchema } from '@/lib/base-knowledge/wire/setup-facts'
import type { ProjectPrimitiveValue, ProjectProfile } from '@/lib/project-profile/types'
import { AT_FACT_DEFINITIONS_VALUES, AT_SETUP_RECORDS } from './at-setup.fixtures'

const state = { profile: emptyProjectProfile() as ProjectProfile, version: 1 }
const writes: ProjectProfile[] = []
let withheld = false

vi.mock('@/lib/projects/repository', () => ({
  findProjectProfileInOrg: async () => ({ profile: state.profile, profileVersion: state.version }),
  listProjectFactsPage: async (afterId: string | null) =>
    afterId
      ? []
      : [
          { id: 'p-open', organizationId: 'org-1', status: 'active' },
          { id: 'p-closed', organizationId: 'org-1', status: 'closed' },
        ],
}))
vi.mock('@/lib/project-profile/profile-service', () => ({
  seedProjectProfile: async (_project: unknown, profile: ProjectProfile) => {
    writes.push(profile)
    state.profile = profile
    state.version += 1
    return { profile }
  },
}))
vi.mock('./classification', () => ({ lawWithheldAt: async () => withheld }))
vi.mock('./setup-records', () => ({ readSetupRecords: async () => AT_SETUP_RECORDS }))
vi.mock('@/lib/base-knowledge/platform/entitlements', () => ({
  readOrganizationCountries: async () => ({ homeCountry: 'AT', entitled: [{ countryId: 'AT' }] }),
}))

const { rederiveBuildingClasses, withPlacementRecorded } = await import('./rederive')
const { assumedSubdivisionOf } = await import('./setup-scope')

const NOW = new Date('2026-11-14T09:00:00.000Z')
const office = { records: AT_SETUP_RECORDS, assumed: assumedSubdivisionOf(AT_SETUP_RECORDS, 'AT', '2026-11-14') }

/** A block of flats with every input the class derivation reads, confirmed, and no site. */
function unplacedBlock(): ProjectProfile {
  const profile = emptyProjectProfile()
  const building: Record<string, ProjectPrimitiveValue> = {
    building_type: 'building',
    building_position: 'freestanding',
    access_three_sides: true,
    storeys_above_ground: 3,
    escape_level_m: 7,
    gfa_above_ground: 800,
    use_units: 3,
    units_over_400: false,
    uses: ['residential'],
  }
  for (const [key, value] of Object.entries(building))
    profile.facts[`${key}@bldg1`] = { value, confidence: 'confirmed', source: 'onboarding', updatedAt: '' }
  return profile
}

describe('the territory an office assumes', () => {
  it('is the home country record’s assumedWhenUnstated option, and none for another country or none', () => {
    expect(office.assumed).toEqual({ factKey: 'federal_state', token: 'vienna', territoryId: 'AT-9' })
    expect(assumedSubdivisionOf(AT_SETUP_RECORDS, 'DE')).toBeNull()
    expect(assumedSubdivisionOf(AT_SETUP_RECORDS, null)).toBeNull()
    expect(assumedSubdivisionOf([], 'AT')).toBeNull()
  })

  it('falls back to the compiled seed’s answer for a released record from before the field', () => {
    const released = AT_SETUP_RECORDS.map((record) => {
      if (record.values.body.kind !== 'fact_definitions') return record
      const copy = structuredClone(record) as typeof record & { values: { body: { payload: { subdivisions?: { assumedWhenUnstated?: string } } } } }
      delete copy.values.body.payload.subdivisions?.assumedWhenUnstated
      return copy
    })
    expect(assumedSubdivisionOf(released, 'AT', '2026-11-14')?.territoryId).toBe('AT-9')
    expect(assumedSubdivisionOf(released, 'AT', '2026-11-14', [])).toBeNull()
  })

  it('must be one of the record’s options', () => {
    const body = AT_FACT_DEFINITIONS_VALUES.body as { payload: unknown }
    const payload = structuredClone(body.payload) as { subdivisions: { assumedWhenUnstated?: string } }
    payload.subdivisions.assumedWhenUnstated = 'atlantis'
    expect(factDefinitionsSchema.safeParse(payload).success).toBe(false)
  })
})

describe('the site a re-derivation records', () => {
  it('writes the office default only where no place is recorded, as an unverified assumption', () => {
    const placed = withPlacementRecorded(emptyProjectProfile(), office, NOW)
    expect(placed.assumptions.federal_state).toMatchObject({ value: 'vienna', status: 'unconfirmed', reason: ASSUMED_SITE_REASON })
    expect(isOfficeDefault(placed.assumptions.federal_state)).toBe(true)
  })

  it('writes the Land the address names over the onboarding default, with its derivation', () => {
    const profile = emptyProjectProfile()
    profile.assumptions.site_address = { value: 'Herrengasse 16, 8010 Graz', status: 'unconfirmed', reason: 'r', source: 'onboarding_default', updatedAt: '', evidence: [{ kind: 'person', userId: 'u1', at: '' }] }
    profile.assumptions.federal_state = { value: 'vienna', status: 'unconfirmed', reason: 'default', source: 'onboarding_default', updatedAt: '' }
    const placed = withPlacementRecorded(profile, office, NOW)
    expect(placed.assumptions.federal_state?.value).toBe('styria')
    expect(isOfficeDefault(placed.assumptions.federal_state)).toBe(false)
  })

  it('leaves a recorded Land, and the onboarding default with no address, as they are', () => {
    const recorded = emptyProjectProfile()
    recorded.facts.federal_state = { value: 'tyrol', confidence: 'confirmed', source: 'onboarding', updatedAt: '' }
    expect(withPlacementRecorded(recorded, office, NOW)).toBe(recorded)
    const defaulted = withAssumedSite(emptyProjectProfile(), office.assumed)
    expect(withPlacementRecorded(defaulted, office, NOW)).toBe(defaulted)
  })
})

describe('a run over every project', () => {
  beforeEach(() => {
    state.profile = unplacedBlock()
    state.version = 1
    writes.length = 0
    withheld = false
  })

  it('records the assumed site and the class it gives, skips a closed project, and writes nothing the second time', async () => {
    const first = await rederiveBuildingClasses({ now: () => NOW })
    expect(first).toEqual({ projects: 2, written: 1, unchanged: 1, failed: 0, complete: true })
    expect(state.profile.assumptions.federal_state?.value).toBe('vienna')
    expect(state.profile.assumptions['building_class@bldg1']?.value).toBeDefined()
    const second = await rederiveBuildingClasses({ now: () => NOW })
    expect(second).toEqual({ projects: 2, written: 0, unchanged: 2, failed: 0, complete: true })
    expect(state.version).toBe(2)
  })

  it('changes nothing while law is withheld, as before a country is released', async () => {
    withheld = true
    const result = await rederiveBuildingClasses({ now: () => NOW })
    expect(result.written).toBe(0)
    expect(writes).toEqual([])
  })

  it('stops at its deadline and says it is not complete', async () => {
    expect(await rederiveBuildingClasses({ deadlineMs: 0 })).toMatchObject({ projects: 0, complete: false })
  })
})
