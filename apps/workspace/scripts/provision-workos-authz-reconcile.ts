import type { Role, WorkOS } from '@workos-inc/node'
import {
  ALL_PERMISSION_SPECS,
  ROLES,
  type PermissionTier,
  type RoleSpec,
} from '../bff/authz/catalog'
import { RETIRED_PERMISSIONS, type RetiredPermission } from '../bff/authz/retired-permissions'

export interface AuthzClient {
  authorization: Pick<
    WorkOS['authorization'],
    | 'listPermissions'
    | 'createPermission'
    | 'deletePermission'
    | 'listEnvironmentRoles'
    | 'listOrganizationRoles'
    | 'createEnvironmentRole'
    | 'createOrganizationRole'
    | 'setEnvironmentRolePermissions'
    | 'setOrganizationRolePermissions'
    | 'removeOrganizationRolePermission'
  >
  organizations: Pick<WorkOS['organizations'], 'getOrganizationByExternalId' | 'listOrganizations'>
}

export interface ReconcileOptions {
  apply: boolean
  platformOrgExternalId: string
  note?: (message: string) => void
  retired?: readonly RetiredPermission[]
}

export interface ReconcileResult {
  drift: string[]
  applied: string[]
}

interface Run {
  client: AuthzClient
  apply: boolean
  platformOrgExternalId: string
  retired: readonly RetiredPermission[]
  drift: string[]
  applied: string[]
  note: (message: string) => void
}

const OUR_NAMESPACES = /^(org|platform|project|skill|folder|workflow):/

const OWNED_PERMISSIONS = ALL_PERMISSION_SPECS.filter((permission) => !permission.system)

async function listAll<T>(
  page: (after?: string) => Promise<{ data: T[]; listMetadata?: { after?: string | null } }>
): Promise<T[]> {
  const all: T[] = []
  let after: string | undefined
  do {
    const result = await page(after)
    all.push(...result.data)
    after = result.listMetadata?.after ?? undefined
  } while (after)
  return all
}

function resourceTypeSlugFor(tier: PermissionTier): string {
  return tier === 'platform' || tier === 'org' ? 'organization' : tier
}

async function reconcilePermissions(run: Run): Promise<void> {
  const { client, drift, applied, note } = run
  note('\nPermissions')
  const existing = await listAll((after) =>
    client.authorization.listPermissions({ after, limit: 100 })
  )
  const bySlug = new Map(existing.map((permission) => [permission.slug, permission]))

  for (const spec of OWNED_PERMISSIONS) {
    const found = bySlug.get(spec.slug)
    if (found) {
      const expected = resourceTypeSlugFor(spec.tier)
      if (found.resourceTypeSlug && found.resourceTypeSlug !== expected) {
        drift.push(
          `permission ${spec.slug} is on resource type ${found.resourceTypeSlug}, expected ${expected}`
        )
        note(`  WRONG    ${spec.slug} — on ${found.resourceTypeSlug}, expected ${expected}`)
        continue
      }
      note(`  ok       ${spec.slug}`)
      continue
    }
    if (!run.apply) {
      drift.push(`permission missing in WorkOS: ${spec.slug} (${spec.tier} tier)`)
      note(`  MISSING  ${spec.slug}`)
      continue
    }
    try {
      await client.authorization.createPermission({
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        resourceTypeSlug: resourceTypeSlugFor(spec.tier),
      })
      applied.push(`created permission ${spec.slug}`)
      note(`  created  ${spec.slug}`)
    } catch (error) {
      drift.push(`could not create ${spec.slug} (${spec.tier} tier): ${String(error)}`)
      note(`  FAILED   ${spec.slug} — ${String(error)}`)
    }
  }

  const declared = new Set(ALL_PERMISSION_SPECS.map((permission) => permission.slug))
  const retired = new Set(run.retired.map((permission) => permission.slug))
  for (const permission of existing) {
    if (declared.has(permission.slug) || retired.has(permission.slug)) continue
    if (!OUR_NAMESPACES.test(permission.slug)) continue
    note(`  UNKNOWN  ${permission.slug} — in WorkOS, absent from the catalog and not retired`)
    drift.push(`permission in WorkOS but neither in the catalog nor retired: ${permission.slug}`)
  }
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((value, index) => value === right[index])
}

async function findPlatformOrgId(run: Run): Promise<string | null> {
  try {
    return (await run.client.organizations.getOrganizationByExternalId(run.platformOrgExternalId))
      .id
  } catch {
    return null
  }
}

async function reconcileRoles(run: Run): Promise<void> {
  const { client, drift, applied, note } = run
  note('\nRoles')

  const envRoles = (await client.authorization.listEnvironmentRoles()).data

  const platformOrgId = await findPlatformOrgId(run)
  let orgRoles: Role[] = []
  if (platformOrgId) {
    orgRoles = (await client.authorization.listOrganizationRoles(platformOrgId)).data
  } else {
    drift.push(
      `platform organization "${run.platformOrgExternalId}" not found — platform roles cannot be verified`
    )
    note(`  MISSING  organization ${run.platformOrgExternalId}`)
  }

  const envBySlug = new Map(envRoles.map((role) => [role.slug, role]))
  const orgBySlug = new Map(orgRoles.map((role) => [role.slug, role]))

  for (const spec of ROLES) {
    const isPlatform = spec.scope === 'platform-org'
    if (isPlatform && !platformOrgId) continue

    const found = isPlatform ? orgBySlug.get(spec.slug) : envBySlug.get(spec.slug)
    if (!found) {
      if (!run.apply) {
        drift.push(`role missing in WorkOS: ${spec.slug} (${spec.scope})`)
        note(`  MISSING  ${spec.slug}`)
        continue
      }
      await createRole(run, spec, platformOrgId)
      continue
    }

    if (sameSet(found.permissions, spec.permissions)) {
      note(`  ok       ${spec.slug}`)
      continue
    }

    const missing = spec.permissions.filter((slug) => !found.permissions.includes(slug))
    const extra = found.permissions.filter((slug) => !spec.permissions.includes(slug))
    const detail = [
      missing.length ? `missing ${missing.join(', ')}` : '',
      extra.length ? `extra ${extra.join(', ')}` : '',
    ]
      .filter(Boolean)
      .join('; ')

    if (!run.apply) {
      drift.push(`role ${spec.slug} permissions differ — ${detail}`)
      note(`  DRIFT    ${spec.slug} — ${detail}`)
      continue
    }

    await setPermissions(run, spec, platformOrgId)
    applied.push(`updated role ${spec.slug} (${detail})`)
    note(`  updated  ${spec.slug} — ${detail}`)
  }
}

async function setPermissions(
  run: Run,
  spec: RoleSpec,
  platformOrgId: string | null
): Promise<void> {
  const permissions = [...spec.permissions]
  if (spec.scope === 'platform-org') {
    if (!platformOrgId) return
    await run.client.authorization.setOrganizationRolePermissions(platformOrgId, spec.slug, {
      permissions,
    })
    return
  }
  await run.client.authorization.setEnvironmentRolePermissions(spec.slug, { permissions })
}

async function createRole(run: Run, spec: RoleSpec, platformOrgId: string | null): Promise<void> {
  const { client } = run
  try {
    if (spec.scope === 'platform-org') {
      if (!platformOrgId) return
      await client.authorization.createOrganizationRole(platformOrgId, {
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        resourceTypeSlug: resourceTypeSlugFor(spec.tier),
      })
    } else {
      await client.authorization.createEnvironmentRole({
        name: spec.name,
        slug: spec.slug,
        description: spec.description,
        resourceTypeSlug: resourceTypeSlugFor(spec.tier),
      })
    }
    await setPermissions(run, spec, platformOrgId)
    run.applied.push(`created role ${spec.slug}`)
    run.note(`  created  ${spec.slug}`)
  } catch (error) {
    run.drift.push(`could not create role ${spec.slug}: ${String(error)}`)
    run.note(`  FAILED   ${spec.slug} — ${String(error)}`)
  }
}

interface Holder {
  role: Role
  organizationId: string | null
}

async function listEveryRole(client: AuthzClient): Promise<Holder[]> {
  const holders: Holder[] = (await client.authorization.listEnvironmentRoles()).data.map(
    (role) => ({
      role,
      organizationId: null,
    })
  )
  const organizations = await listAll((after) =>
    client.organizations.listOrganizations({ after, limit: 100 })
  )
  for (const organization of organizations) {
    const roles = (await client.authorization.listOrganizationRoles(organization.id)).data
    for (const role of roles) {
      if (role.type === 'OrganizationRole') holders.push({ role, organizationId: organization.id })
    }
  }
  return holders
}

async function retireOne(run: Run, slug: string, holders: readonly Holder[]): Promise<void> {
  const { client } = run
  for (const holder of holders) {
    if (!holder.role.permissions.includes(slug)) continue
    if (holder.organizationId) {
      await client.authorization.removeOrganizationRolePermission(
        holder.organizationId,
        holder.role.slug,
        {
          permissionSlug: slug,
        }
      )
    } else {
      await client.authorization.setEnvironmentRolePermissions(holder.role.slug, {
        permissions: holder.role.permissions.filter((held) => held !== slug),
      })
    }
    holder.role.permissions = holder.role.permissions.filter((held) => held !== slug)
    run.applied.push(`removed retired permission ${slug} from role ${holder.role.slug}`)
    run.note(`  removed  ${slug} from role ${holder.role.slug}`)
  }
  await client.authorization.deletePermission(slug)
  run.applied.push(`deleted retired permission ${slug}`)
  run.note(`  deleted  ${slug}`)
}

async function retirePermissions(run: Run): Promise<void> {
  const { client, drift, note } = run
  const declared = new Set(ALL_PERMISSION_SPECS.map((permission) => permission.slug))
  const contradictions = run.retired.filter((permission) => declared.has(permission.slug))
  for (const permission of contradictions) {
    drift.push(`retired permission is still declared in the catalog, not retired: ${permission.slug}`)
    note(`  REFUSED  ${permission.slug} — declared and retired at once; nothing deleted`)
  }
  if (contradictions.length > 0) return
  const existing = new Set(
    (await listAll((after) => client.authorization.listPermissions({ after, limit: 100 }))).map(
      (permission) => permission.slug
    )
  )
  const present = run.retired.filter((permission) => existing.has(permission.slug))
  if (present.length === 0) return

  note('\nRetired permissions')
  if (!run.apply) {
    for (const permission of present) {
      note(`  RETIRED  ${permission.slug} — retired, still present: run with --apply`)
      drift.push(
        `retired permission still present: ${permission.slug} (${permission.retiredBy}); run with --apply`
      )
    }
    return
  }

  const holders = await listEveryRole(client)
  for (const permission of present) {
    try {
      await retireOne(run, permission.slug, holders)
    } catch (error) {
      drift.push(`could not retire ${permission.slug}: ${String(error)}`)
      note(`  FAILED   ${permission.slug} — ${String(error)}`)
    }
  }
}

export async function reconcileAuthzCatalog(
  client: AuthzClient,
  options: ReconcileOptions
): Promise<ReconcileResult> {
  const run: Run = {
    client,
    apply: options.apply,
    platformOrgExternalId: options.platformOrgExternalId,
    retired: options.retired ?? RETIRED_PERMISSIONS,
    drift: [],
    applied: [],
    note: options.note ?? (() => {}),
  }
  await reconcilePermissions(run)
  await reconcileRoles(run)
  await retirePermissions(run)
  return { drift: run.drift, applied: run.applied }
}

export function exitCodeFor(result: ReconcileResult): 0 | 1 {
  return result.drift.length === 0 ? 0 : 1
}
