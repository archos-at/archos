import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import { SYSTEM_ACTORS } from '@/lib/audit/service'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { dropMail } from './repository'
import { eraseStagedObjects } from './staging'
import { returnReleasedErasure, takeReleasedErasure, type DeferredErasure } from './sweep-erasure-repository'

export async function dropAutomaticMail(mail: InboundMailRow, reason: NonNullable<InboundMailRow['droppedReason']>): Promise<void> {
  if (!(await dropMail(mail.id, { reason, erasureDeferred: true }))) return
  recordAuditEventAfterCommit({
    organizationId: mail.organizationId,
    actor: { userId: SYSTEM_ACTORS.inboundMail, email: null },
    action: 'inbound_mail.received',
    targetType: 'inbound_mail',
    targetId: mail.id,
    alsoTargets: [{ type: 'project', id: mail.projectId }],
    metadata: { projectId: mail.projectId, dropped: reason },
    idempotencyKey: `inbound_mail.received:${mail.id}`,
  })
  captureServer({ event: 'inbound_mail_dropped', distinctId: null, organizationId: mail.organizationId, properties: { reason } })
  await eraseDroppedMail(mail)
}

async function eraseDroppedMail(mail: InboundMailRow): Promise<void> {
  const erasure: DeferredErasure = {
    id: mail.id,
    kind: 'mail',
    organizationId: mail.organizationId,
    stagingBucket: mail.stagingBucket,
    storageKey: null,
    readKey: mail.readStorageKey,
    rawKey: mail.rawStorageKey,
    keys: [mail.readStorageKey, mail.rawStorageKey].filter((key): key is string => key !== null),
  }
  if (erasure.keys.length === 0) return
  const now = new Date()
  if (!(await takeReleasedErasure(erasure, now))) return
  const kept = await eraseStagedObjects(mail.stagingBucket, erasure.keys).catch(() => erasure.keys)
  if (kept.length === 0) return
  await returnReleasedErasure(erasure, kept, now)
  console.warn(`[inbound-mail] the dropped mail ${mail.id} kept ${kept.length} staged object(s); the released-erasure sweep tries again`)
}
