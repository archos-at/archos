/**
 * Step 3 of the receive job (`./receive-job.ts`): automatic mail nobody needs to
 * see is dropped, its raw message erased by its key (a legal hold defers the
 * erasure).
 */
import 'server-only'
import { captureServer } from '@/lib/analytics/posthog-server'
import { recordAuditEventAfterCommit } from '@/lib/audit/after-commit'
import { SYSTEM_ACTORS } from '@/lib/audit/service'
import { isCoveredByActiveHold } from '@/lib/compliance/repository'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import type { JobAttempt } from '@/lib/jobs-queue/types'
import { dropMail } from './repository'
import { eraseStagedObjects } from './staging'

export async function dropAutomaticMail(mail: InboundMailRow, reason: NonNullable<InboundMailRow['droppedReason']>, attempt: JobAttempt): Promise<void> {
  const deferred = await isCoveredByActiveHold(mail.organizationId, 'project', mail.projectId)
  if (!deferred && mail.rawStorageKey) {
    const left = await eraseStagedObjects(mail.stagingBucket, [mail.rawStorageKey])
    // The key may only go with its object: retry, and on the last attempt let
    // the deferred-erasure sweep finish it.
    if (left.length > 0 && !attempt.last) throw new Error(`the raw message of mail ${mail.id} could not be erased`)
    if (left.length > 0) return void (await dropMail(mail.id, { reason, erasureDeferred: true }))
  }
  if (!(await dropMail(mail.id, { reason, erasureDeferred: deferred }))) return
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
}
