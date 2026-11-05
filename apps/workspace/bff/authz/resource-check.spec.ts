/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listEffectivePermissionsByExternalId = vi.fn()
vi.mock('@/lib/workos/client', () => ({
  getWorkOS: () => ({ authorization: { listEffectivePermissionsByExternalId } }),
}))

import { effectiveResourcePermissions, forgetResourceGrants } from './resource-check'
import { setCacheStore } from '@/lib/cache'
import { MapCacheStore } from '@/test-utils/cache-store'

const INPUT = {
  organizationMembershipId: 'om_1',
  organizationId: 'org_1',
  resourceExternalId: 'proj_1',
  resourceTypeSlug: 'project',
} as const

/** WorkOS answering that the membership holds `slugs` on the resource. */
function holds(...slugs: string[]) {
  return { autoPagination: async () => slugs.map((slug) => ({ slug })) }
}

const effectiveKeys = (store: MapCacheStore) => [...store.map.keys()].filter((key) => key.startsWith('authz:effective:'))

describe('effectiveResourcePermissions', () => {
  let store: MapCacheStore

  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    store = new MapCacheStore()
    setCacheStore(store)
    // The default TTL (30s) stays ON: these tests assert what survives it.
    delete process.env.AUTHZ_CACHE_TTL_MS
    listEffectivePermissionsByExternalId.mockResolvedValue(holds('project:view'))
  })

  it('does not cache an error-induced denial: error then success within TTL succeeds', async () => {
    // A transport failure fails closed WITHOUT writing the entry, so the
    // next request re-checks live instead of replaying the denial for 30s.
    listEffectivePermissionsByExternalId.mockRejectedValueOnce(new Error('workos unreachable'))
    expect((await effectiveResourcePermissions(INPUT)).size).toBe(0)
    expect((await effectiveResourcePermissions(INPUT)).has('project:view')).toBe(true)
    expect(listEffectivePermissionsByExternalId).toHaveBeenCalledTimes(2)
  })

  it('caches a completed answer, an unknown resource (404) included', async () => {
    listEffectivePermissionsByExternalId.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }))
    expect((await effectiveResourcePermissions(INPUT)).size).toBe(0)
    expect((await effectiveResourcePermissions(INPUT)).size).toBe(0)
    expect(listEffectivePermissionsByExternalId).toHaveBeenCalledTimes(1)
  })

  it('never shares a cached answer across organizations', async () => {
    // Same membership and resource — only the org differs. The first org's
    // grant must not leak into the second org's check.
    expect((await effectiveResourcePermissions(INPUT)).has('project:view')).toBe(true)
    listEffectivePermissionsByExternalId.mockResolvedValue(holds())
    expect((await effectiveResourcePermissions({ ...INPUT, organizationId: 'org_2' })).size).toBe(0)
    expect(listEffectivePermissionsByExternalId).toHaveBeenCalledTimes(2)
    const keys = effectiveKeys(store)
    expect(keys).toHaveLength(2)
    expect(keys.some((key) => key.startsWith('authz:effective:org_1:om_1:'))).toBe(true)
    expect(keys.some((key) => key.startsWith('authz:effective:org_2:om_1:'))).toBe(true)
  })

  it('keys a missing org under the literal no-org segment, never alongside an org', async () => {
    const { organizationId: _omitted, ...withoutOrg } = INPUT
    await effectiveResourcePermissions(withoutOrg)
    expect(effectiveKeys(store)).toHaveLength(1)
    expect(effectiveKeys(store)[0]).toMatch(/^authz:effective:no-org:om_1:[^:]+:project:proj_1$/)
  })

  it('sees a revocation at once once the membership’s grants are forgotten, not after the TTL', async () => {
    expect((await effectiveResourcePermissions(INPUT)).has('project:view')).toBe(true)
    listEffectivePermissionsByExternalId.mockResolvedValue(holds())
    // Still the cached grant: nothing said the roles changed.
    expect((await effectiveResourcePermissions(INPUT)).has('project:view')).toBe(true)

    await forgetResourceGrants('org_1', 'om_1')

    expect((await effectiveResourcePermissions(INPUT)).size).toBe(0)
    expect(listEffectivePermissionsByExternalId).toHaveBeenCalledTimes(2)
  })

  it('a read in flight while the roles change cannot cache the old grant back', async () => {
    let answer!: (value: ReturnType<typeof holds>) => void
    listEffectivePermissionsByExternalId.mockImplementationOnce(
      () => new Promise((resolve) => (answer = resolve))
    )
    const inFlight = effectiveResourcePermissions(INPUT)
    await vi.waitFor(() => expect(listEffectivePermissionsByExternalId).toHaveBeenCalledTimes(1))

    // The role is removed while WorkOS is still answering with the old grant.
    await forgetResourceGrants('org_1', 'om_1')
    answer(holds('project:view'))
    expect((await inFlight).has('project:view')).toBe(true)

    listEffectivePermissionsByExternalId.mockResolvedValue(holds())
    expect((await effectiveResourcePermissions(INPUT)).size).toBe(0)
  })

  it('forgetting one membership leaves another membership’s answers cached', async () => {
    await effectiveResourcePermissions(INPUT)
    await effectiveResourcePermissions({ ...INPUT, organizationMembershipId: 'om_2' })
    await forgetResourceGrants('org_1', 'om_1')
    await effectiveResourcePermissions({ ...INPUT, organizationMembershipId: 'om_2' })
    expect(listEffectivePermissionsByExternalId).toHaveBeenCalledTimes(2)
  })
})
