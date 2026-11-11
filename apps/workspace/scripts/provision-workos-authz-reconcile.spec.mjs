/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import { ALL_PERMISSION_SPECS, ROLES } from '../bff/authz/catalog.ts'
import { exitCodeFor, reconcileAuthzCatalog } from './provision-workos-authz-reconcile.ts'

const RETIRED = 'platform:knowledge:approve_as_second_reviewer'
const PLATFORM_ORG = { id: 'org_platform', externalId: 'platform-org' }
const OFFICE_ORG = { id: 'org_office', externalId: 'office' }

const copyOf = (role) => ({ ...role, permissions: [...role.permissions] })

/**
 * A WorkOS environment that already matches the catalog, as an in-memory fake
 * of the SDK surface the reconcile calls. `calls` records every write in order.
 */
function fakeWorkos({ extraPermissions = [], heldBy = [] } = {}) {
  const permissions = [
    ...ALL_PERMISSION_SPECS.map((spec) => ({
      slug: spec.slug,
      resourceTypeSlug:
        spec.system || spec.tier === 'org' || spec.tier === 'platform' ? 'organization' : spec.tier,
    })),
    ...extraPermissions.map((slug) => ({ slug, resourceTypeSlug: 'organization' })),
  ]
  const role = (spec, type) => ({ slug: spec.slug, type, permissions: [...spec.permissions] })
  const envRoles = ROLES.filter((spec) => spec.scope !== 'platform-org').map((spec) =>
    role(spec, 'EnvironmentRole')
  )
  const orgRoles = {
    [PLATFORM_ORG.id]: ROLES.filter((spec) => spec.scope === 'platform-org').map((spec) =>
      role(spec, 'OrganizationRole')
    ),
    [OFFICE_ORG.id]: [],
  }
  for (const holder of heldBy) {
    if (holder.organizationId)
      orgRoles[holder.organizationId].push(role(holder, 'OrganizationRole'))
    else envRoles.push(role(holder, 'EnvironmentRole'))
  }
  const calls = []
  const find = (roles, slug) => roles.find((candidate) => candidate.slug === slug)
  const client = {
    authorization: {
      listPermissions: async () => ({ data: [...permissions], listMetadata: {} }),
      createPermission: async (options) => {
        calls.push(['createPermission', options.slug])
        permissions.push({ slug: options.slug, resourceTypeSlug: options.resourceTypeSlug })
      },
      deletePermission: async (slug) => {
        const holders = [...envRoles, ...Object.values(orgRoles).flat()].filter((candidate) =>
          candidate.permissions.includes(slug)
        )
        // Stricter than WorkOS documents, so the spec holds the order.
        if (holders.length > 0) {
          throw new Error(
            `${slug} is still held by ${holders.map((holder) => holder.slug).join(', ')}`
          )
        }
        calls.push(['deletePermission', slug])
        permissions.splice(
          permissions.findIndex((permission) => permission.slug === slug),
          1
        )
      },
      listEnvironmentRoles: async () => ({ data: envRoles.map(copyOf) }),
      // As WorkOS does: an organization's listing repeats the environment roles.
      listOrganizationRoles: async (organizationId) => ({
        data: [...envRoles, ...orgRoles[organizationId]].map(copyOf),
      }),
      createEnvironmentRole: async (options) => calls.push(['createEnvironmentRole', options.slug]),
      createOrganizationRole: async (_organizationId, options) =>
        calls.push(['createOrganizationRole', options.slug]),
      setEnvironmentRolePermissions: async (slug, options) => {
        calls.push(['setEnvironmentRolePermissions', slug, options.permissions])
        find(envRoles, slug).permissions = [...options.permissions]
      },
      setOrganizationRolePermissions: async (organizationId, slug, options) => {
        calls.push(['setOrganizationRolePermissions', organizationId, slug])
        find(orgRoles[organizationId], slug).permissions = [...options.permissions]
      },
      removeOrganizationRolePermission: async (organizationId, slug, options) => {
        calls.push([
          'removeOrganizationRolePermission',
          organizationId,
          slug,
          options.permissionSlug,
        ])
        const target = find(orgRoles[organizationId], slug)
        target.permissions = target.permissions.filter((held) => held !== options.permissionSlug)
      },
    },
    organizations: {
      getOrganizationByExternalId: async () => PLATFORM_ORG,
      listOrganizations: async () => ({ data: [PLATFORM_ORG, OFFICE_ORG], listMetadata: {} }),
    },
  }
  return { client, calls, permissionSlugs: () => permissions.map((permission) => permission.slug) }
}

const reconcile = (client, apply) =>
  reconcileAuthzCatalog(client, { apply, platformOrgExternalId: PLATFORM_ORG.externalId })

/** A retired permission still held by an environment role and by an office's custom role. */
const environmentWithRetiredPermission = () =>
  fakeWorkos({
    extraPermissions: [RETIRED],
    heldBy: [
      { slug: 'legacy-reviewer', organizationId: null, permissions: ['org:audit:view', RETIRED] },
      { slug: 'office-reviewer', organizationId: OFFICE_ORG.id, permissions: [RETIRED] },
    ],
  })

describe('reconcileAuthzCatalog', () => {
  it('writes nothing and reports nothing when the environment matches the catalog', async () => {
    const { client, calls } = fakeWorkos()
    const result = await reconcile(client, true)
    expect(result).toEqual({ drift: [], applied: [] })
    expect(calls).toEqual([])
    expect(exitCodeFor(result)).toBe(0)
  })

  it('apply takes a retired permission off every role holding it, then deletes it, and exits 0', async () => {
    const { client, calls, permissionSlugs } = environmentWithRetiredPermission()
    const result = await reconcile(client, true)

    expect(result.drift).toEqual([])
    expect(exitCodeFor(result)).toBe(0)
    expect(calls).toEqual([
      ['setEnvironmentRolePermissions', 'legacy-reviewer', ['org:audit:view']],
      ['removeOrganizationRolePermission', OFFICE_ORG.id, 'office-reviewer', RETIRED],
      ['deletePermission', RETIRED],
    ])
    expect(permissionSlugs()).not.toContain(RETIRED)
    expect(result.applied).toContain(`deleted retired permission ${RETIRED}`)

    // The next deploy finds nothing to do.
    expect(await reconcile(client, true)).toEqual({ drift: [], applied: [] })
  })

  it('apply resets a catalog role before the delete, so the permission leaves it too', async () => {
    const fake = fakeWorkos({ extraPermissions: [RETIRED] })
    const owner = ROLES.find((spec) => spec.slug === 'org-platform-owner')
    await fake.client.authorization.setOrganizationRolePermissions(PLATFORM_ORG.id, owner.slug, {
      permissions: [...owner.permissions, RETIRED],
    })
    fake.calls.length = 0

    const result = await reconcile(fake.client, true)
    expect(exitCodeFor(result)).toBe(0)
    expect(fake.calls).toEqual([
      ['setOrganizationRolePermissions', PLATFORM_ORG.id, owner.slug],
      ['deletePermission', RETIRED],
    ])
    expect(fake.permissionSlugs()).not.toContain(RETIRED)
  })

  it('check reports a retired permission as drift and writes nothing', async () => {
    const { client, calls, permissionSlugs } = environmentWithRetiredPermission()
    const result = await reconcile(client, false)

    expect(calls).toEqual([])
    expect(permissionSlugs()).toContain(RETIRED)
    expect(result.drift).toHaveLength(1)
    expect(result.drift[0]).toContain(`retired permission still present: ${RETIRED}`)
    expect(result.drift[0]).toContain('run with --apply')
    expect(exitCodeFor(result)).toBe(1)
  })

  it.each([true, false])(
    'an unknown slug that is not retired stays drift and is kept (apply: %s)',
    async (apply) => {
      const { client, calls, permissionSlugs } = fakeWorkos({
        extraPermissions: ['platform:made:by_hand'],
      })
      const result = await reconcile(client, apply)

      expect(result.drift).toEqual([
        'permission in WorkOS but neither in the catalog nor retired: platform:made:by_hand',
      ])
      expect(exitCodeFor(result)).toBe(1)
      expect(calls).toEqual([])
      expect(permissionSlugs()).toContain('platform:made:by_hand')
    }
  )

  it('ignores a permission outside our namespaces', async () => {
    const { client } = fakeWorkos({ extraPermissions: ['vendor:something:new'] })
    expect((await reconcile(client, false)).drift).toEqual([])
  })

  it('a delete WorkOS refuses is drift, so the Job fails and says why', async () => {
    const { client } = fakeWorkos({ extraPermissions: [RETIRED] })
    client.authorization.deletePermission = async () => {
      throw new Error('403')
    }
    const result = await reconcile(client, true)
    expect(result.drift).toEqual([`could not retire ${RETIRED}: Error: 403`])
    expect(exitCodeFor(result)).toBe(1)
  })
})
