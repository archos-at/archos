import 'server-only'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findOrganization } from './repository'
import { writeDedicatedOrgSetting } from './service'

export const CONFIDENTIAL_RELEASE_FORBIDDEN_SETTING = 'confidentialReleaseForbidden'

export function resolveConfidentialReleaseForbidden(stored: unknown): boolean {
  return stored === true
}

export async function confidentialReleaseForbidden(organizationId: string): Promise<boolean> {
  const row = await findOrganization(organizationId)
  const settings = (row?.settings ?? {}) as Record<string, unknown>
  return resolveConfidentialReleaseForbidden(settings[CONFIDENTIAL_RELEASE_FORBIDDEN_SETTING])
}

export async function saveConfidentialReleaseForbidden(
  session: AuthorizedSession,
  forbidden: boolean,
  request: Request
): Promise<boolean> {
  const previous = await confidentialReleaseForbidden(session.organizationId)
  await writeDedicatedOrgSetting(session.organizationId, CONFIDENTIAL_RELEASE_FORBIDDEN_SETTING, forbidden)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.confidential_release.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { forbidden: String(forbidden), previous: String(previous) },
    request,
  })
  return forbidden
}
