import 'server-only'
import { getWorkOS } from '@/lib/workos/client'
import {
  ORG_WIDGET_PERMISSIONS,
  USERS_TABLE_MANAGE,
  isOrgAdmin,
  type OrgWidgetPermission,
} from '@/lib/authz/organizations'
import {
  getPlatformOrganizationId,
  PlatformAccessDeniedError,
  requirePlatformPermission,
} from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { ForbiddenError, ServiceUnavailableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'

const ALLOWED = new Set<string>(ORG_WIDGET_PERMISSIONS)

function grants(session: AuthorizedSession, scope: OrgWidgetPermission): boolean {
  if (scope === USERS_TABLE_MANAGE) return isOrgAdmin(session)
  return session.permissions.includes(scope)
}

export async function mintWidgetToken(
  session: AuthorizedSession,
  requestedScopes: string[],
  forPlatformOrg: boolean
): Promise<{ token: string }> {
  let organizationId = session.organizationId
  let holdsScope = (scope: OrgWidgetPermission): boolean => grants(session, scope)
  if (forPlatformOrg) {
    try {
      await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsManage)
    } catch (error) {
      if (error instanceof PlatformAccessDeniedError) throw new ForbiddenError()
      throw error
    }
    const platformOrgId = await getPlatformOrganizationId()
    if (!platformOrgId) {
      throw new ServiceUnavailableError('Platform organization is not provisioned')
    }
    organizationId = platformOrgId
    holdsScope = (scope) => scope === USERS_TABLE_MANAGE
  }

  const scopes = requestedScopes
    .filter((s): s is OrgWidgetPermission => ALLOWED.has(s))
    .filter(holdsScope)

  const { token } = await getWorkOS().widgets.createToken({
    organizationId,
    userId: session.userId,
    ...(scopes.length > 0 ? { scopes } : {}),
  })

  return { token }
}
