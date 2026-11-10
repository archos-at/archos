/**
 * The gate every platform-knowledge service passes first (ADR-0165): the
 * platform permission, then the `platform-base-knowledge` flag of the platform
 * organization. An unknown platform organization reads as off: fail closed.
 */

import 'server-only'
import { ForbiddenError } from '@/lib/api/errors'
import type { UserSession } from '@/lib/auth/types'
import { FEATURE_FLAGS } from '@/lib/authz/feature-flags'
import type { PlatformPermission } from '@/lib/authz/permissions'
import { getPlatformOrganizationId, requirePlatformPermission } from '@/lib/authz/platform'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'

/** The platform organization has not switched platform knowledge on. */
export class PlatformKnowledgeDisabledError extends ForbiddenError {
  constructor() {
    super('Platform base knowledge is not enabled for the platform organization.')
  }
}

export async function requirePlatform(session: UserSession | null, permission: PlatformPermission): Promise<UserSession> {
  await requirePlatformPermission(session, permission)
  const platformOrganizationId = await getPlatformOrganizationId()
  if (!platformOrganizationId || !(await isOrgFeatureEnabled(FEATURE_FLAGS.platformBaseKnowledge, platformOrganizationId))) {
    throw new PlatformKnowledgeDisabledError()
  }
  return session as UserSession
}
