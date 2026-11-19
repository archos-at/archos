import 'server-only'

import { notFiledReasonOf } from '@/lib/mail-thread/attachment-rows'
import { decidePendingAttachment, findEntryOfMail } from '@/lib/mail-thread/write-repository'
import { isRestorable } from './decision-repository'
import { INBOUND_MAIL_RESTORE_DAYS } from './inbound-mail-vocabulary'
import { findMailParts, findProjectMail } from './review-read-repository'

const RESTORE_MS = INBOUND_MAIL_RESTORE_DAYS * 86_400_000

export async function decideEndedAttachments(
  projectId: string,
  mailIds: readonly string[],
  now: Date = new Date(),
): Promise<void> {
  const restorableAfter = new Date(now.getTime() - RESTORE_MS)
  for (const mailId of new Set(mailIds)) {
    const entry = await findEntryOfMail(projectId, mailId)
    const mail = entry ? await findProjectMail(projectId, mailId) : null
    if (!entry || !mail) continue
    for (const part of await findMailParts([mailId])) {
      if (part.kind !== 'attachment' || (part.state !== 'dismissed' && part.state !== 'expired')) continue
      if (isRestorable(mail, part, restorableAfter)) continue
      const reason = notFiledReasonOf(part)
      if (reason !== 'pending') {
        await decidePendingAttachment(entry.id, part.position, { disposition: 'not_filed', reason })
      }
    }
  }
}
