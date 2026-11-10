/**
 * @vitest-environment node
 *
 * One office's placement from its directory entry and its rows: placed, or
 * why not (no row yet, one the directory will fill, or nobody stated it), and
 * its entitlements with the home first.
 */

import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/client', () => ({ getWorkOS: vi.fn() }))

import { placementOf } from './organization-countries'

const AT = { organizationId: 'org_a', countryId: 'AT', entitledBy: 'user_op', decisionSource: 'app', entitledAt: new Date('2026-11-01T00:00:00Z') }
const CH = { ...AT, countryId: 'CH' }

describe('an office’s placement', () => {
  it('lists the home first, then what the platform entitled, and not the home twice', () => {
    const placement = placementOf({ id: 'org_a', name: 'Büro A' }, { homes: new Map([['org_a', 'AT']]), entitlements: [AT, CH] })
    expect(placement.homeCountry).toBe('AT')
    expect(placement.unplaced).toBeNull()
    expect(placement.entitled.map((entry) => [entry.countryId, entry.source])).toEqual([
      ['AT', 'home'],
      ['CH', 'platform'],
    ])
    expect(placement.entitled[1]).toMatchObject({ entitledBy: 'user_op', decisionSource: 'app', entitledAt: '2026-11-01T00:00:00.000Z' })
  })

  it('says an office nobody signed in to has no row yet', () => {
    expect(placementOf({ id: 'org_b', name: 'Büro B' }, { homes: new Map(), entitlements: [] }).unplaced).toEqual({
      reason: 'no_row',
      directoryHomeCountry: null,
    })
  })

  it('names the country the directory will write on the next page load, with a row or without one', () => {
    const office = { id: 'org_c', name: 'Büro C', metadata: { home_country: ' de ' } }
    const named = { reason: 'directory_names', directoryHomeCountry: 'DE' }
    expect(placementOf(office, { homes: new Map(), entitlements: [] }).unplaced).toEqual(named)
    expect(placementOf(office, { homes: new Map([['org_c', null]]), entitlements: [] }).unplaced).toEqual(named)
  })

  it('says a row whose admins never stated a country is not stated, and keeps its entitlements', () => {
    const placement = placementOf({ id: 'org_a', name: 'Büro A' }, { homes: new Map([['org_a', null]]), entitlements: [AT] })
    expect(placement.unplaced).toEqual({ reason: 'not_stated', directoryHomeCountry: null })
    expect(placement.entitled).toEqual([expect.objectContaining({ countryId: 'AT', source: 'platform' })])
  })
})
