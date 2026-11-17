/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'

import {
  ALL_PERMISSION_SPECS,
  ORG_PERMISSION_SPECS,
  PLATFORM_PERMISSION_SPECS,
  PROJECT_PERMISSION_SPECS,
  RESOURCE_TYPES,
  ROLES,
  FOLDER_PERMISSION_SPECS,
  findPermissionSpec,
  findRoleSpec,
  type PermissionTier,
} from './catalog'
import {
  ORG_PERMISSIONS,
  PLATFORM_PERMISSIONS,
  PROJECT_PERMISSIONS,
  FOLDER_PERMISSIONS,
} from './permissions'

describe('authorization catalog', () => {
  it('has no duplicate permission slugs', () => {
    const slugs = ALL_PERMISSION_SPECS.map((permission) => permission.slug)
    expect(slugs).toEqual([...new Set(slugs)])
  })

  it('has no duplicate role slugs', () => {
    const slugs = ROLES.map((role) => role.slug)
    expect(slugs).toEqual([...new Set(slugs)])
  })

  it('every permission a role grants exists in the catalog', () => {
    const known = new Set(ALL_PERMISSION_SPECS.map((permission) => permission.slug))
    const dangling = ROLES.flatMap((role) =>
      role.permissions.filter((slug) => !known.has(slug)).map((slug) => `${role.slug} -> ${slug}`)
    )
    expect(dangling).toEqual([])
  })

  it("every permission's slug prefix matches its tier", () => {
    const mismatched = ALL_PERMISSION_SPECS.filter((permission) => {
      if (permission.system) return false // widgets:* are WorkOS-owned
      const prefix = permission.slug.split(':')[0]
      return prefix !== permission.tier
    }).map((permission) => `${permission.slug} is ${permission.tier}-tier`)
    expect(mismatched).toEqual([])
  })

  it('NO tenant-assignable role may hold a platform permission', () => {
    const platformSlugs = new Set(PLATFORM_PERMISSION_SPECS.map((p) => p.slug))
    const leaked = ROLES.filter((role) => role.scope === 'environment').flatMap((role) =>
      role.permissions
        .filter((slug) => platformSlugs.has(slug))
        .map((slug) => `${role.slug} -> ${slug}`)
    )
    expect(leaked).toEqual([])
  })

  it('platform-org roles hold no org: permission (tiers stay separate)', () => {
    const orgSlugs = new Set(ORG_PERMISSION_SPECS.map((p) => p.slug))
    const mixed = ROLES.filter((role) => role.scope === 'platform-org').flatMap((role) =>
      role.permissions.filter((slug) => orgSlugs.has(slug)).map((slug) => `${role.slug} -> ${slug}`)
    )
    expect(mixed).toEqual([])
  })

  it('the resource topology is a tree rooted at organization', () => {
    const bySlug = new Map(RESOURCE_TYPES.map((type) => [type.slug, type]))
    const roots = RESOURCE_TYPES.filter((type) => type.parent === null)
    expect(roots.map((type) => type.slug)).toEqual(['organization'])
    for (const type of RESOURCE_TYPES) {
      if (type.parent === null) continue
      expect(bySlug.has(type.parent), `${type.slug} parent ${type.parent}`).toBe(true)
    }
  })

  it('WorkOS caps descriptions at 150 characters — resource types AND permissions', () => {
    for (const type of RESOURCE_TYPES) {
      expect(type.description.length, `${type.slug} description`).toBeLessThanOrEqual(150)
    }
    for (const permission of ALL_PERMISSION_SPECS) {
      if (permission.system) continue // WorkOS owns the widgets:* copy
      expect(
        permission.description.length,
        `${permission.slug} description`
      ).toBeLessThanOrEqual(150)
    }
  })

  it('every permission/role tier maps to a declared resource type', () => {
    const typeSlugs = new Set(RESOURCE_TYPES.map((type) => type.slug))
    const resourceTypeFor = (tier: PermissionTier): string =>
      tier === 'platform' || tier === 'org' ? 'organization' : tier
    const unattached = [
      ...new Set([
        ...ALL_PERMISSION_SPECS.map((permission) => resourceTypeFor(permission.tier)),
        ...ROLES.map((role) => resourceTypeFor(role.tier)),
      ]),
    ].filter((slug) => !typeSlugs.has(slug))
    expect(unattached).toEqual([])
  })

  it('the registry constants and the catalog agree on every slug', () => {
    const registrySlugs: string[] = [
      ...Object.values(ORG_PERMISSIONS),
      ...Object.values(PLATFORM_PERMISSIONS),
      ...Object.values(PROJECT_PERMISSIONS),
      ...Object.values(FOLDER_PERMISSIONS),
    ]
    for (const slug of registrySlugs) {
      expect(findPermissionSpec(slug), `${slug} must exist in the catalog`).toBeDefined()
    }
    const registry = new Set(registrySlugs)
    const unexposed = [
      ...ORG_PERMISSION_SPECS,
      ...PLATFORM_PERMISSION_SPECS,
      ...PROJECT_PERMISSION_SPECS,
      ...FOLDER_PERMISSION_SPECS,
    ]
      .filter((permission) => !registry.has(permission.slug) && !permission.deprecated)
      .map((permission) => permission.slug)
    expect(unexposed).toEqual([])
  })

  it('platform-tier role slugs carry the org- prefix WorkOS requires', () => {
    const unprefixed = ROLES.filter((role) => role.tier === 'platform' && !role.slug.startsWith('org-'))
    expect(unprefixed.map((role) => role.slug)).toEqual([])
  })

  it('Admin holds the org-wide project bypass, so existing admins keep every project', () => {
    expect(findRoleSpec('admin')?.permissions).toContain('org:projects:administer')
  })

  it('no role below Admin holds the project bypass', () => {
    const holders = ROLES.filter(
      (role) => role.tier === 'org' && role.permissions.includes('org:projects:administer')
    ).map((role) => role.slug)
    expect(holders).toEqual(['admin'])
  })

  it('read-only platform staff hold no platform write permission', () => {
    const support = findRoleSpec('org-platform-support')
    expect(support).toBeDefined()
    expect(support!.permissions.filter((slug) => slug.endsWith(':manage'))).toEqual([])
  })

  describe('read-only observability (Langfuse)', () => {

    it('the analyst role holds the observability permission and nothing else', () => {
      const analyst = findRoleSpec('org-platform-observability-analyst')
      expect(analyst).toMatchObject({ tier: 'platform', scope: 'platform-org' })
      expect(analyst!.permissions).toEqual(['platform:observability:view'])
    })

    it('every role that sees all organizations also holds it', () => {
      const missing = ROLES.filter(
        (role) =>
          role.permissions.includes('platform:organizations:view') &&
          !role.permissions.includes('platform:observability:view')
      ).map((role) => role.slug)
      expect(missing).toEqual([])
    })

    it('only platform-org roles hold it', () => {
      const holders = ROLES.filter((role) => role.permissions.includes('platform:observability:view'))
      expect(holders.map((role) => role.scope)).toEqual(holders.map(() => 'platform-org'))
      expect(holders.map((role) => role.slug).sort()).toEqual(
        ['org-platform-owner', 'org-platform-support', 'org-platform-observability-analyst'].sort()
      )
    })
  })

  it('every project role is assignable through the members API', () => {
    const assignable = ['project-viewer', 'project-contributor', 'project-editor', 'project-admin']
    const projectRoles = ROLES.filter((role) => role.tier === 'project').map((role) => role.slug)
    expect(projectRoles.sort()).toEqual([...assignable].sort())
  })

  describe('machine authorship is separable and never standalone', () => {
    it('no role grants generate without the write permission it rides on', () => {
      const broken = ROLES.filter(
        (role) =>
          role.permissions.includes('project:documents:generate') &&
          !role.permissions.includes('project:documents:write')
      ).map((role) => role.slug)
      expect(broken).toEqual([])
    })

    it('the built-in editor and admin hold it; the read-only personas do not', () => {
      for (const slug of ['project-editor', 'project-admin']) {
        expect(findRoleSpec(slug)?.permissions, slug).toContain('project:documents:generate')
      }
      for (const slug of ['project-viewer', 'project-contributor']) {
        expect(findRoleSpec(slug)?.permissions, slug).not.toContain('project:documents:generate')
      }
    })
  })

  it('the fine-grained org personas each hold a strict subset of Admin', () => {
    const admin = new Set(findRoleSpec('admin')?.permissions ?? [])
    for (const slug of [
      'org-auditor',
      'org-billing-admin',
      'org-compliance-officer',
      'org-knowledge-manager',
    ]) {
      const role = findRoleSpec(slug)
      expect(role, slug).toBeDefined()
      const outside = role!.permissions.filter((permission) => !admin.has(permission))
      expect(outside, `${slug} holds permissions Admin does not`).toEqual([])
      expect(role!.permissions.length).toBeLessThan(admin.size)
    }
  })
})
