import 'server-only'
import type { SwitchableOrganization } from './switchable'
import { findOrganization, upsertOrganization } from './repository'
import { getWorkOS } from '@/lib/workos/client'
import { getCached, invalidateCached } from '@/lib/cache'
import { invalidateBackendModelConfig } from '@/lib/model-config/backend-key'
import { DEDICATED_ROUTE_SETTINGS, PLATFORM_OWNED_SETTINGS, type Organization } from '@/lib/db/schema/organizations'
import { BadRequestError, ConflictError, ForbiddenError } from '@/lib/api/errors'
import { residencyCell } from '@/lib/residency/cell'
import { recordAuditEvent } from '@/lib/audit/service'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'
import { isLocale, type Locale } from '@/i18n/config'

export interface OrganizationOverview {
  id: string
  name: string
  domains: string[]
  createdAt: string
  memberCount: number
  memberCountCapped: boolean
  pendingInviteCount: number
}

export interface OrgSettings {
  displayName: string | null
  defaultLocale: Locale | null
  homeCountry: string | null
  settings: Record<string, unknown>
}

const PAGE_LIMIT = 100

export async function getOrganizationOverview(
  organizationId: string
): Promise<OrganizationOverview> {
  const workos = getWorkOS()

  const org = await workos.organizations.getOrganization(organizationId)

  let memberCount = 0
  let memberCountCapped = false
  try {
    const memberships = await workos.userManagement.listOrganizationMemberships({
      organizationId,
      statuses: ['active'],
      limit: PAGE_LIMIT,
    })
    memberCount = memberships.data.length
    memberCountCapped = Boolean(memberships.listMetadata?.after)
  } catch {
    // Non-fatal — the widget still shows the authoritative roster.
  }

  let pendingInviteCount = 0
  try {
    const invitations = await workos.userManagement.listInvitations({
      organizationId,
      limit: PAGE_LIMIT,
    })
    pendingInviteCount = invitations.data.filter((i) => i.state === 'pending').length
  } catch {
    // Non-fatal.
  }

  return {
    id: org.id,
    name: org.name,
    domains: org.domains?.map((d) => d.domain) ?? [],
    createdAt: org.createdAt.toISOString(),
    memberCount,
    memberCountCapped,
    pendingInviteCount,
  }
}

export interface OrganizationMember {
  id: string
  email: string
  name: string | null
}

export interface OrganizationMemberWithRole extends OrganizationMember {
  roleSlug: string | null
  status: string
}

export async function listOrganizationMembers(
  organizationId: string
): Promise<OrganizationMember[]> {
  const workos = getWorkOS()
  const users = await workos.userManagement.listUsers({ organizationId, limit: PAGE_LIMIT })
  return users.data
    .map((user) => ({
      id: user.id,
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
    }))
    .sort((a, b) => a.email.localeCompare(b.email))
}

export async function listOrganizationMembersWithRoles(
  organizationId: string
): Promise<OrganizationMemberWithRole[]> {
  const workos = getWorkOS()
  const memberships = await workos.userManagement.listOrganizationMemberships({
    organizationId,
    limit: PAGE_LIMIT,
  })

  const identities = new Map<string, { email: string; name: string | null }>()
  try {
    const users = await workos.userManagement.listUsers({ organizationId, limit: PAGE_LIMIT })
    for (const user of users.data) {
      identities.set(user.id, {
        email: user.email,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      })
    }
  } catch {
    // Non-fatal: the roster is still useful without display names.
  }

  return memberships.data
    .map((membership) => {
      const identity = identities.get(membership.userId)
      return {
        id: membership.userId,
        email: identity?.email ?? membership.userId,
        name: identity?.name ?? null,
        roleSlug: membership.role?.slug ?? null,
        status: String(membership.status),
      }
    })
    .sort((a, b) => a.email.localeCompare(b.email))
}

function toSettings(row: Organization | undefined): OrgSettings {
  return {
    displayName: row?.displayName ?? null,
    defaultLocale: isLocale(row?.defaultLocale) ? row.defaultLocale : null,
    homeCountry: row?.homeCountry ?? null,
    settings: (row?.settings as Record<string, unknown> | undefined) ?? {},
  }
}

export async function getOrgSettings(organizationId: string): Promise<OrgSettings> {
  return toSettings((await findOrganization(organizationId)) ?? undefined)
}

const ORG_NAME_CACHE_TTL_MS = 300_000
const orgNameCacheKey = (organizationId: string): string => `orgname:${organizationId}`

export async function getOrganizationDisplayName(
  organizationId: string | null | undefined
): Promise<string | null> {
  if (!organizationId) return null
  try {
    return await getCached(orgNameCacheKey(organizationId), ORG_NAME_CACHE_TTL_MS, async () => {
      const { displayName } = await getOrgSettings(organizationId)
      if (displayName) return displayName
      const org = await getWorkOS().organizations.getOrganization(organizationId)
      return org.name || null
    })
  } catch {
    return null
  }
}

const SWITCHER_CACHE_TTL_MS = 5 * 60_000

const SWITCHER_MEMBERSHIP_LIMIT = 50

export async function switchableOrganizations(
  organizationId: string | null | undefined,
  userId: string
): Promise<SwitchableOrganization[]> {
  try {
    return await getCached(`organization-switcher:${organizationId ?? 'none'}:${userId}`, SWITCHER_CACHE_TTL_MS, async () => {
      const memberships = await getWorkOS().userManagement.listOrganizationMemberships({
        userId,
        statuses: ['active'],
        limit: SWITCHER_MEMBERSHIP_LIMIT,
      })
      if (memberships.data.length < 2) return []
      return memberships.data
        .map((membership) => ({
          id: membership.organizationId,
          name: membership.organizationName || membership.organizationId,
          current: membership.organizationId === organizationId,
        }))
        .sort((a, b) => a.name.localeCompare(b.name))
    })
  } catch {
    return []
  }
}

export interface OrgSettingsPatch {
  displayName?: string | null
  defaultLocale?: Locale | null
  settings?: Record<string, unknown>
}

export async function updateOrgSettings(
  organizationId: string,
  patch: OrgSettingsPatch
): Promise<OrgSettings> {
  const keys = Object.keys(patch.settings ?? {})
  const offending = keys.filter((key) => (PLATFORM_OWNED_SETTINGS as readonly string[]).includes(key))
  if (offending.length > 0) {
    throw new ForbiddenError(
      `${offending.join(', ')} ${offending.length === 1 ? 'is' : 'are'} set by the platform ` +
        'operator, not by the organization.'
    )
  }
  const dedicated = keys.filter((key): key is keyof typeof DEDICATED_ROUTE_SETTINGS =>
    Object.prototype.hasOwnProperty.call(DEDICATED_ROUTE_SETTINGS, key)
  )
  if (dedicated.length > 0) {
    throw new BadRequestError(
      dedicated.map((key) => `${key} cannot be changed here: ${DEDICATED_ROUTE_SETTINGS[key]}.`).join(' ')
    )
  }
  return writeOrgSettings(organizationId, patch)
}

export async function updatePlatformOwnedOrgSettings(
  session: UserSession | null,
  organizationId: string,
  patch: OrgSettingsPatch
): Promise<OrgSettings> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsManage)
  return writeOrgSettings(organizationId, patch)
}

export async function writeDedicatedOrgSetting(
  organizationId: string,
  key: keyof typeof DEDICATED_ROUTE_SETTINGS,
  value: unknown
): Promise<OrgSettings> {
  if (!Object.prototype.hasOwnProperty.call(DEDICATED_ROUTE_SETTINGS, key)) {
    throw new BadRequestError(`${String(key)} is not a dedicated setting`)
  }
  return writeOrgSettings(organizationId, { settings: { [key]: value } })
}

async function writeOrgSettings(
  organizationId: string,
  patch: OrgSettingsPatch
): Promise<OrgSettings> {
  const current = await getOrgSettings(organizationId)
  const next: OrgSettings = {
    displayName: patch.displayName !== undefined ? patch.displayName : current.displayName,
    defaultLocale: patch.defaultLocale !== undefined ? patch.defaultLocale : current.defaultLocale,
    homeCountry: current.homeCountry,
    settings: patch.settings ? { ...current.settings, ...patch.settings } : current.settings,
  }

  await upsertOrganization({
    organizationId,
    displayName: next.displayName,
    defaultLocale: next.defaultLocale,
    settings: next.settings,
  })

  return next
}

const WEB_SEARCH_CACHE_TTL_MS = 30_000
const webSearchCacheKey = (organizationId: string): string => `websearch:${organizationId}`

export async function isWebSearchEnabledForOrg(
  organizationId: string | null | undefined
): Promise<boolean> {
  if (!organizationId) return true
  return getCached(webSearchCacheKey(organizationId), WEB_SEARCH_CACHE_TTL_MS, async () => {
    const { settings } = await getOrgSettings(organizationId)
    if (settings.webSearchEnabled === false) return false
    return isOrgFeatureEnabled(FEATURE_FLAGS.webSearch, organizationId)
  })
}

const ZDR_ONLY_CACHE_TTL_MS = 30_000
const zdrOnlyCacheKey = (organizationId: string): string => `zdronly:v2:${organizationId}`

export async function isZdrOnlyForOrg(organizationId: string | null | undefined): Promise<boolean> {
  if (!organizationId || residencyCell() !== null) return true
  return getCached(zdrOnlyCacheKey(organizationId), ZDR_ONLY_CACHE_TTL_MS, async () => {
    const { settings } = await getOrgSettings(organizationId)
    return isZdrOnlySetting(settings.zdrOnly)
  })
}

export function isZdrOnlySetting(value: unknown): boolean {
  return value !== false
}

export async function setOrgZdrOnly(
  session: AuthorizedSession,
  enabled: boolean,
  request: Request
): Promise<{ zdrOnly: boolean; previous: boolean }> {
  if (!enabled && residencyCell() !== null) {
    throw new ConflictError('Zero data retention is required in this residency cell and cannot be switched off.')
  }
  const before = await getOrgSettings(session.organizationId)
  const previous = isZdrOnlySetting(before.settings.zdrOnly)
  await writeOrgSettings(session.organizationId, { settings: { zdrOnly: enabled } })
  await invalidateCached(zdrOnlyCacheKey(session.organizationId))
  await invalidateBackendModelConfig(session.organizationId)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'model_config.zdr.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { zdrOnly: String(enabled), previous: String(previous) },
    request,
  })
  return { zdrOnly: enabled, previous }
}

export async function setOrgWebSearchEnabled(
  session: AuthorizedSession,
  enabled: boolean,
  request: Request
): Promise<{ webSearchEnabled: boolean; previous: boolean }> {
  const before = await getOrgSettings(session.organizationId)
  const previous = before.settings.webSearchEnabled !== false
  await writeDedicatedOrgSetting(session.organizationId, 'webSearchEnabled', enabled)
  await invalidateCached(webSearchCacheKey(session.organizationId))
  if (previous !== enabled) await invalidateBackendModelConfig(session.organizationId)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.settings.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { fields: previous === enabled ? '' : 'settings.webSearchEnabled' },
    request,
  })
  return { webSearchEnabled: enabled, previous }
}

export async function saveOrgSettings(
  session: AuthorizedSession,
  patch: OrgSettingsPatch,
  request: Request
): Promise<OrgSettings> {
  const before = await getOrgSettings(session.organizationId)
  const settings = await updateOrgSettings(session.organizationId, patch)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.settings.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { fields: changedSettingsFields(before, settings).join(',') },
    request,
  })
  return settings
}

export function changedSettingsFields(before: OrgSettings, after: OrgSettings): string[] {
  const fields: string[] = []
  if (before.displayName !== after.displayName) fields.push('displayName')
  if (before.defaultLocale !== after.defaultLocale) fields.push('defaultLocale')
  if (before.homeCountry !== after.homeCountry) fields.push('homeCountry')
  const keys = new Set([...Object.keys(before.settings), ...Object.keys(after.settings)])
  for (const key of [...keys].sort()) {
    if (JSON.stringify(before.settings[key]) !== JSON.stringify(after.settings[key])) fields.push(`settings.${key}`)
  }
  return fields
}
