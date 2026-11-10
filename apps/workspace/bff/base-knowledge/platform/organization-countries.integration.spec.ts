/**
 * @vitest-environment node
 *
 * `platform-org-countries-list` against a REAL Postgres, through the service
 * the route and the door call: every office of the directory with its home
 * country or why it has none, and its entitlements, read as the platform role;
 * the platform organization left out; read only for `platform:organizations:view`.
 *
 *   TEST_DATABASE_URL=postgres://app_rw@host:port/app \
 *     npx vitest run bff/base-knowledge/platform/organization-countries.integration.spec.ts
 */

import { beforeAll, describe, expect, it, vi } from 'vitest'
import type { UserSession } from '@/lib/auth/types'

const fixed = vi.hoisted(() => ({ run: Date.now().toString(36) }))
const RUN = fixed.run
const PLATFORM = `org_platform_place_${fixed.run}`
const PLACED = `org_place_a_${fixed.run}`
const UNSEEN = `org_place_b_${fixed.run}`
const NAMED = `org_place_c_${fixed.run}`
const UNSTATED = `org_place_d_${fixed.run}`

vi.mock('server-only', () => ({}))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: async () => true }))
vi.mock('@/lib/authz/platform', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/authz/platform')>()
  return {
    ...real,
    getPlatformOrganizationId: async () => `org_platform_place_${fixed.run}`,
    requirePlatformPermission: async (session: { permissions?: string[] } | null, permission: string) => {
      if (!session?.permissions?.includes(permission)) throw new real.PlatformAccessDeniedError(`Platform permission required: ${permission}`)
    },
  }
})
vi.mock('@/lib/workos/client', () => ({
  getWorkOS: () => ({
    organizations: {
      listOrganizations: async () => ({
        data: [
          { id: `org_platform_place_${fixed.run}`, name: 'Plattform' },
          { id: `org_place_a_${fixed.run}`, name: 'Büro A' },
          { id: `org_place_b_${fixed.run}`, name: 'Büro B' },
          { id: `org_place_c_${fixed.run}`, name: 'Büro C', metadata: { home_country: 'DE' } },
          { id: `org_place_d_${fixed.run}`, name: 'Büro D' },
        ],
        listMetadata: { after: null },
      }),
    },
  }),
}))

const url = process.env.TEST_DATABASE_URL
const person = (permissions: string[]) =>
  ({ userId: `user_place_${RUN}`, email: 'op@example.com', organizationId: PLATFORM, permissions }) as unknown as UserSession
const DECISION = { by: `user_place_${RUN}`, decisionSource: 'app' as const }

describe('the organization placement suite is not silently skipped in CI', () => {
  it('has a database to run against', () => {
    if (!process.env.RLS_SUITE_REQUIRED) return
    expect(url, 'TEST_DATABASE_URL is unset while RLS_SUITE_REQUIRED is set').toBeTruthy()
  })
})

describe.skipIf(!url)('where every office is placed (platform-org-countries-list)', () => {
  let service: typeof import('./service')

  beforeAll(async () => {
    process.env.APP_DATABASE_URL = url
    service = await import('./service')
    const entitlements = await import('./entitlements')
    const repository = await import('@/lib/organizations/repository')
    await entitlements.moveHomeCountry(PLACED, 'AT', DECISION)
    await entitlements.setEntitlement(PLACED, 'CH', true, DECISION)
    await repository.createOrganizationRow(UNSTATED)
    await entitlements.setEntitlement(UNSTATED, 'AT', true, DECISION)
  })

  it('lists every office with its home or why it has none, the unplaced first, and leaves the platform out', async () => {
    const answer = await service.listOrganizationPlacements(person(['platform:organizations:view']))
    const byId = new Map(answer.organizations.map((office) => [office.organizationId, office]))
    expect(byId.has(PLATFORM)).toBe(false)
    expect(answer.unplaced).toBe(3)
    expect(answer.nextCursor).toBeNull()
    expect(answer.organizations.slice(0, 3).every((office) => office.homeCountry === null)).toBe(true)
    expect(byId.get(PLACED)).toMatchObject({
      homeCountry: 'AT',
      unplaced: null,
      entitled: [
        { countryId: 'AT', source: 'home' },
        { countryId: 'CH', source: 'platform', entitledBy: DECISION.by, decisionSource: 'app' },
      ],
    })
    expect(byId.get(UNSEEN)?.unplaced).toEqual({ reason: 'no_row', directoryHomeCountry: null })
    expect(byId.get(NAMED)?.unplaced).toEqual({ reason: 'directory_names', directoryHomeCountry: 'DE' })
    expect(byId.get(UNSTATED)).toMatchObject({
      unplaced: { reason: 'not_stated' },
      entitled: [{ countryId: 'AT', source: 'platform' }],
    })
  })

  it('answers 403 without platform:organizations:view', async () => {
    await expect(service.listOrganizationPlacements(person(['platform:settings:view']))).rejects.toMatchObject({ status: 403 })
  })
})
