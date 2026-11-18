import 'server-only'
import { getOrgSettings, updatePlatformOwnedOrgSettings } from '@/lib/organizations/service'
import {
  aggregateStorageUsage,
  insertDocumentWithinQuota,
  replaceDocumentWithinQuota,
  sumStorageBytes,
  type StorageUsageByScope,
} from './repository'
import { readKnownOrganizationUsage } from './known-organization'
import { getEffectiveMaxUploadBytes } from './upload-limit'
import type { NewDocument } from '@/lib/db/schema/documents'
import { documentShelf } from '@/lib/documents/shelf'
import { publishShelfChanged } from '@/lib/documents/shelf-live'
import { InsufficientStorageError, UnprocessableError } from '@/lib/api/errors'
import { recordAuditEvent } from '@/lib/audit/service'
import { requirePlatformPermission } from '@/lib/authz/platform'
import { PLATFORM_PERMISSIONS } from '@/lib/authz/permissions'
import type { AuthorizedSession, UserSession } from '@/lib/auth/types'

export const STORAGE_QUOTA_EXCEEDED_MESSAGE =
  'This organization has no storage space left. Delete documents or ask an administrator to raise the quota.'

export const STORAGE_QUOTA_SETTING = 'storageQuotaBytes'

function platformDefaultQuotaBytes(): number | null {
  const raw = process.env.DEFAULT_STORAGE_QUOTA_BYTES
  if (!raw) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null
}

export function effectiveQuotaFromSettings(settings: Record<string, unknown>): number | null {
  const configured = settings[STORAGE_QUOTA_SETTING]
  if (typeof configured === 'number' && Number.isFinite(configured) && configured > 0) {
    return Math.floor(configured)
  }
  if (configured === null) return null
  return platformDefaultQuotaBytes()
}

export async function getStorageQuotaBytes(organizationId: string): Promise<number | null> {
  const { settings } = await getOrgSettings(organizationId)
  return effectiveQuotaFromSettings(settings)
}

export interface StorageOverview {
  usage: StorageUsageByScope
  quotaBytes: number | null
  effectiveMaxUploadFileBytes: number
}

export async function getStorageOverview(session: AuthorizedSession): Promise<StorageOverview> {
  const [usage, quotaBytes, effectiveMaxUploadFileBytes] = await Promise.all([
    aggregateStorageUsage(session.organizationId),
    getStorageQuotaBytes(session.organizationId),
    getEffectiveMaxUploadBytes(session.organizationId),
  ])

  return { usage, quotaBytes, effectiveMaxUploadFileBytes }
}

export async function getOrganizationStorage(organizationId: string): Promise<StorageOverview> {
  const [usage, quotaBytes, effectiveMaxUploadFileBytes] = await Promise.all([
    aggregateStorageUsage(organizationId),
    getStorageQuotaBytes(organizationId),
    getEffectiveMaxUploadBytes(organizationId),
  ])
  return { usage, quotaBytes, effectiveMaxUploadFileBytes }
}

export async function assertWithinStorageQuota(
  organizationId: string,
  incomingBytes: number
): Promise<void> {
  const quotaBytes = await getStorageQuotaBytes(organizationId)
  if (quotaBytes === null) return

  const usedBytes = await sumStorageBytes(organizationId)
  if (usedBytes + incomingBytes <= quotaBytes) return

  throw new InsufficientStorageError(
    STORAGE_QUOTA_EXCEEDED_MESSAGE,
    { quotaBytes, usedBytes, requestedBytes: incomingBytes }
  )
}

export async function admitDocumentWithinQuota(values: NewDocument): Promise<void> {
  const quotaBytes = await getStorageQuotaBytes(values.organizationId)
  const result = await insertDocumentWithinQuota(values, quotaBytes)
  if (result.ok) {
    publishShelfChanged(values.organizationId, documentShelf({ scope: values.scope, projectId: values.projectId ?? null }))
    return
  }

  throw new InsufficientStorageError(
    STORAGE_QUOTA_EXCEEDED_MESSAGE,
    {
      quotaBytes: quotaBytes ?? 0,
      usedBytes: result.usedBytes,
      requestedBytes: values.fileSize ?? 0,
    }
  )
}

export async function admitReplacementWithinQuota(
  organizationId: string,
  documentId: string,
  next: {
    storageKey: string
    storageBucket: string | null
    fileSize: number
    contentType: string | null
    contentHash: string | null
    folderId: string | null
    createdBy: string
    uploadBatchId?: string | null
  },
): Promise<void> {
  const quotaBytes = await getStorageQuotaBytes(organizationId)
  const result = await replaceDocumentWithinQuota(organizationId, documentId, next, quotaBytes)
  if (result.ok) return

  throw new InsufficientStorageError(
    STORAGE_QUOTA_EXCEEDED_MESSAGE,
    {
      quotaBytes: quotaBytes ?? 0,
      usedBytes: result.usedBytes,
      requestedBytes: next.fileSize,
    }
  )
}

export async function setStorageQuota(
  session: UserSession,
  organizationId: string,
  quotaBytes: number | null,
  request?: Request
): Promise<StorageOverview> {
  await requirePlatformPermission(session, PLATFORM_PERMISSIONS.organizationsManage)

  const usage = await readKnownOrganizationUsage(organizationId)

  if (quotaBytes !== null) {
    if (!Number.isFinite(quotaBytes) || quotaBytes <= 0) {
      throw new UnprocessableError('Quota must be a positive number of bytes')
    }
    if (quotaBytes < usage.total.bytes) {
      throw new UnprocessableError('Quota is below the storage this organization already uses', {
        usedBytes: usage.total.bytes,
        requestedQuotaBytes: quotaBytes,
      })
    }
  }

  await updatePlatformOwnedOrgSettings(session, organizationId, {
    settings: { [STORAGE_QUOTA_SETTING]: quotaBytes === null ? null : Math.floor(quotaBytes) },
  })

  await recordAuditEvent({
    organizationId: organizationId,
    actor: { userId: session.userId, email: session.email },
    action: 'org.storage_quota.updated',
    targetType: 'organization',
    targetId: organizationId,
    metadata: { quotaBytes: quotaBytes === null ? 0 : Math.floor(quotaBytes) },
    request,
  })

  const [effectiveQuota, effectiveMaxUploadFileBytes] = await Promise.all([
    getStorageQuotaBytes(organizationId),
    getEffectiveMaxUploadBytes(organizationId),
  ])
  return { usage, quotaBytes: effectiveQuota, effectiveMaxUploadFileBytes }
}
