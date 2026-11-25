import 'server-only'
import { getCached, invalidateCached } from '@/lib/cache'
import { recordAuditEvent } from '@/lib/audit/service'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findOrganization } from './repository'
import { writeDedicatedOrgSetting } from './service'

export const CONFIDENTIAL_RELEASE_SETTING = 'confidentialRelease'

const CACHE_TTL_MS = 30_000
const cacheKey = (organizationId: string): string => `confidential-release:${organizationId}`

export function resolveConfidentialRelease(stored: unknown): boolean {
  return stored !== false
}

export async function confidentialReleaseEnabled(organizationId: string): Promise<boolean> {
  return getCached(cacheKey(organizationId), CACHE_TTL_MS, async () => {
    const row = await findOrganization(organizationId)
    const settings = (row?.settings ?? {}) as Record<string, unknown>
    return resolveConfidentialRelease(settings[CONFIDENTIAL_RELEASE_SETTING])
  })
}

export async function saveConfidentialRelease(
  session: AuthorizedSession,
  enabled: boolean,
  request: Request
): Promise<boolean> {
  const previous = await confidentialReleaseEnabled(session.organizationId)
  await writeDedicatedOrgSetting(session.organizationId, CONFIDENTIAL_RELEASE_SETTING, enabled)
  await invalidateCached(cacheKey(session.organizationId))
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
