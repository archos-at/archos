import 'server-only'
import { FileTooLargeError, UnprocessableError, formatMegabytes } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import type { UserSession } from '@/lib/auth/types'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { isIfcFilename } from '@/lib/bim/types'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import { getCached, invalidateCached } from '@/lib/cache'
import { getOrgSettings, updatePlatformOwnedOrgSettings } from '@/lib/organizations/service'
import {
  maxDocumentBytesFrom,
  maxIfcBytesFrom,
  requestBodyLimitBytes,
} from '@/shared/config/request-body-limit'
import { MIN_UPLOAD_LIMIT_BYTES, judgeUploadLimitBytes } from './contract'
import { readKnownOrganizationUsage } from './known-organization'

export const MAX_UPLOAD_FILE_SETTING = 'maxUploadFileBytes'

export interface UploadLimitBounds {
  defaultBytes: number
  minBytes: number
  ceilingBytes: number
}

export function uploadLimitBounds(
  env: Record<string, string | undefined> = process.env
): UploadLimitBounds {
  return {
    defaultBytes: maxDocumentBytesFrom(env),
    minBytes: MIN_UPLOAD_LIMIT_BYTES,
    ceilingBytes: requestBodyLimitBytes(env),
  }
}

export function configuredUploadLimit(settings: Record<string, unknown>): number | null {
  const value = settings[MAX_UPLOAD_FILE_SETTING]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : null
}

export function effectiveUploadLimit(configured: number | null, bounds: UploadLimitBounds): number {
  if (configured === null) return bounds.defaultBytes
  return Math.min(Math.max(configured, bounds.minBytes), bounds.ceilingBytes)
}

const UPLOAD_LIMIT_CACHE_TTL_MS = 30_000
const uploadLimitCacheKey = (organizationId: string): string => `uploadlimit:${organizationId}`

export async function getEffectiveMaxUploadBytes(organizationId: string): Promise<number> {
  const configured = await getCached(
    uploadLimitCacheKey(organizationId),
    UPLOAD_LIMIT_CACHE_TTL_MS,
    async () => configuredUploadLimit((await getOrgSettings(organizationId)).settings)
  )
  return effectiveUploadLimit(configured, uploadLimitBounds())
}

export async function assertFileSizeAllowed(
  organizationId: string,
  sizeBytes: number,
  filename?: string
): Promise<void> {
  const ceiling =
    filename && isIfcFilename(filename)
      ? maxIfcBytesFrom(process.env)
      : await getEffectiveMaxUploadBytes(organizationId)
  if (sizeBytes > ceiling) {
    throw new FileTooLargeError({ fileSize: sizeBytes, maxSizeBytes: ceiling })
  }
}

export interface UploadLimitState {
  maxUploadFileBytes: number | null
  effectiveMaxUploadFileBytes: number
}

export async function setMaxUploadFileBytes(
  session: UserSession,
  organizationId: string,
  maxUploadFileBytes: number | null,
  request?: Request
): Promise<UploadLimitState> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsManage)
  await readKnownOrganizationUsage(organizationId)

  const bounds = uploadLimitBounds()
  if (maxUploadFileBytes !== null && !judgeUploadLimitBytes(maxUploadFileBytes, bounds.ceilingBytes).ok) {
    throw new UnprocessableError(
      `Upload limit must be between ${formatMegabytes(bounds.minBytes)} MB and ` +
        `${formatMegabytes(bounds.ceilingBytes)} MB, the largest request this deployment accepts`,
      { ...bounds, requestedBytes: maxUploadFileBytes }
    )
  }

  await updatePlatformOwnedOrgSettings(session, organizationId, {
    settings: { [MAX_UPLOAD_FILE_SETTING]: maxUploadFileBytes },
  })
  await invalidateCached(uploadLimitCacheKey(organizationId))

  await recordAuditEvent({
    organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.upload_limit.updated',
    targetType: 'organization',
    targetId: organizationId,
    metadata: { maxUploadFileBytes: maxUploadFileBytes ?? 0 },
    request,
  })

  return {
    maxUploadFileBytes,
    effectiveMaxUploadFileBytes: effectiveUploadLimit(maxUploadFileBytes, bounds),
  }
}
