import 'server-only'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findOrganization } from './repository'
import { writeDedicatedOrgSetting } from './service'

export const CONFIDENTIAL_RELEASE_SETTING = 'confidentialRelease'

export function resolveConfidentialRelease(stored: unknown): boolean {
  return stored === true
}

export async function confidentialReleaseEnabled(organizationId: string): Promise<boolean> {
  const row = await findOrganization(organizationId)
  const settings = (row?.settings ?? {}) as Record<string, unknown>
  return resolveConfidentialRelease(settings[CONFIDENTIAL_RELEASE_SETTING])
}

export async function saveConfidentialRelease(
  session: AuthorizedSession,
  enabled: boolean,
  request: Request
): Promise<boolean> {
  const previous = await confidentialReleaseEnabled(session.organizationId)
  await writeDedicatedOrgSetting(session.organizationId, CONFIDENTIAL_RELEASE_SETTING, enabled)
  await recordAuditEvent({
    organizationId: session.organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.confidential_release.updated',
    targetType: 'organization',
    targetId: session.organizationId,
    metadata: { enabled: String(enabled), previous: String(previous) },
    request,
  })
  return enabled
}
