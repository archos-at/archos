/**
 * SQL for a forward's original (`./receive-original`, migration 0196): the
 * columns the receive job writes on a `received` mail. No authorization: the
 * job runs as the system in the mail's organization, and row-level security is
 * the backstop.
 */

import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMails, type InboundMailRow } from '@/lib/db/schema/inbound-mail'

/** The original's columns on `inbound_mails`. */
export type OriginalFields = Pick<
  InboundMailRow,
  | 'originalAuthorAddress'
  | 'originalAuthorName'
  | 'originalSentAt'
  | 'originalSubject'
  | 'originalMessageId'
  | 'originalSource'
>

/** Write the original on a mail the job has not held yet. Any number of mails may carry one original's Message-ID. */
export async function recordOriginalFields(mailId: string, fields: OriginalFields): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
}
