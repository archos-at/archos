import 'server-only'
import type { InboxEmission } from '@/lib/inbox/service'
import { emitInboxItems } from '@/lib/inbox/service'
import { archiveInboxItemsOfType, findLiveInboxGroupKeys } from '@/lib/inbox/repository'
import { inboxGroupKey } from '@/lib/inbox/registry'
import { withTenant } from '@/lib/db/tenant-context'
import { activeMembersHolding } from '@/lib/organizations/members-holding'
import { aggregateStorageUsageByOrganization } from './repository'
import { getStorageQuotaBytes } from './service'

export const STORAGE_ALERT_TYPE = 'storage.quota_warning' as const

export const STORAGE_ALERT_PERMISSION = 'org:settings:manage'

const DEFAULT_THRESHOLD_PERCENT = 80

const ESCALATION_PERCENTS = [90, 100] as const

export function storageAlertThresholdPercent(
  raw = process.env.STORAGE_ALERT_THRESHOLD_PERCENT,
): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 100) return DEFAULT_THRESHOLD_PERCENT
  return parsed
}

function bucketsFor(thresholdPercent: number): number[] {
  return [thresholdPercent, ...ESCALATION_PERCENTS.filter((step) => step > thresholdPercent)]
}

export function crossedBucketPercent(
  usedBytes: number,
  quotaBytes: number | null,
  thresholdPercent = storageAlertThresholdPercent(),
): number | null {
  if (quotaBytes === null || quotaBytes <= 0) return null
  const usedPercent = (usedBytes / quotaBytes) * 100
  const crossed = bucketsFor(thresholdPercent).filter((bucket) => usedPercent >= bucket)
  return crossed.length > 0 ? crossed[crossed.length - 1] : null
}

export async function findStorageAlertRecipients(organizationId: string): Promise<string[]> {
  return activeMembersHolding(organizationId, STORAGE_ALERT_PERMISSION)
}

export type StorageAlertStatus =
  | 'unlimited'
  | 'below-threshold'
  | 'suppressed'
  | 'no-recipients'
  | 'alerted'

export interface StorageAlertOutcome {
  organizationId: string
  status: StorageAlertStatus
  usedPercent: number | null
  bucketPercent: number | null
  notified: number
  retired: number
}

export interface EvaluateStorageAlertOptions {
  thresholdPercent?: number
  quotaBytes?: number | null
}

export async function evaluateStorageAlert(
  organizationId: string,
  usedBytes: number,
  options: EvaluateStorageAlertOptions = {},
): Promise<StorageAlertOutcome> {
  const thresholdPercent = options.thresholdPercent ?? storageAlertThresholdPercent()
  const quotaBytes =
    options.quotaBytes !== undefined ? options.quotaBytes : await getStorageQuotaBytes(organizationId)

  const usedPercent =
    quotaBytes !== null && quotaBytes > 0 ? Math.round((usedBytes / quotaBytes) * 100) : null
  const bucketPercent = crossedBucketPercent(usedBytes, quotaBytes, thresholdPercent)

  if (bucketPercent === null) {
    const retired = await archiveInboxItemsOfType(organizationId, STORAGE_ALERT_TYPE)
    return {
      organizationId,
      status: quotaBytes === null || quotaBytes <= 0 ? 'unlimited' : 'below-threshold',
      usedPercent,
      bucketPercent: null,
      notified: 0,
      retired,
    }
  }

  const anchorId = String(bucketPercent)
  const retired = await archiveInboxItemsOfType(organizationId, STORAGE_ALERT_TYPE, {
    exceptAnchorId: anchorId,
  })

  const recipients = await findStorageAlertRecipients(organizationId)
  if (recipients.length === 0) {
    console.warn(
      `[storage-alert] ${organizationId} is at ${usedPercent}% of its storage quota but has no active member holding "${STORAGE_ALERT_PERMISSION}" — nobody was notified`,
    )
    return {
      organizationId,
      status: 'no-recipients',
      usedPercent,
      bucketPercent,
      notified: 0,
      retired,
    }
  }

  const groupKey = inboxGroupKey(STORAGE_ALERT_TYPE, 'organization', organizationId, anchorId)
  const live = await findLiveInboxGroupKeys(
    organizationId,
    recipients.map((recipientUserId) => ({ recipientUserId, groupKey })),
  )

  const emissions: InboxEmission[] = recipients
    .filter((recipientUserId) => !live.has(`${recipientUserId}\n${groupKey}`))
    .map((recipientUserId) => ({
      organizationId,
      recipientUserId,
      type: STORAGE_ALERT_TYPE,
      resourceType: 'organization',
      resourceId: organizationId,
      anchorId,
      actorUserId: null,
      groupKey,
      payload: {
        subject: `${usedPercent}%`,
        usedBytes,
        quotaBytes,
        usedPercent,
        thresholdPercent,
        bucketPercent,
      },
    }))

  if (emissions.length === 0) {
    return { organizationId, status: 'suppressed', usedPercent, bucketPercent, notified: 0, retired }
  }

  await emitInboxItems(emissions)
  return {
    organizationId,
    status: 'alerted',
    usedPercent,
    bucketPercent,
    notified: emissions.length,
    retired,
  }
}

export interface StorageAlertSweepResult {
  organizationsChecked: number
  alerted: number
  notified: number
  retired: number
  thresholdPercent: number
}

export async function runStorageAlertSweep(): Promise<StorageAlertSweepResult> {
  const thresholdPercent = storageAlertThresholdPercent()
  const usageByOrg = await aggregateStorageUsageByOrganization()

  const outcomes: StorageAlertOutcome[] = []
  for (const [organizationId, usage] of usageByOrg) {
    try {
      outcomes.push(
        await withTenant({ organizationId }, () =>
          evaluateStorageAlert(organizationId, usage.bytes, { thresholdPercent }),
        ),
      )
    } catch (error) {
      console.error(`[storage-alert] evaluation failed for ${organizationId}:`, error)
    }
  }

  return {
    organizationsChecked: usageByOrg.size,
    alerted: outcomes.filter((outcome) => outcome.status === 'alerted').length,
    notified: outcomes.reduce((sum, outcome) => sum + outcome.notified, 0),
    retired: outcomes.reduce((sum, outcome) => sum + outcome.retired, 0),
    thresholdPercent,
  }
}
