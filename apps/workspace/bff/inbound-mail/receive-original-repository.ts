/**
 * SQL for a forward's original (`./receive-original`, migration 0195): the
 * columns the receive job writes on a `received` mail, and whether the project
 * already filed that original. No authorization: the job runs as the system
 * in the mail's organization, and row-level security is the backstop.
 */

import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMails, type InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { mailThreadEntries } from '@/lib/db/schema/mail-thread'

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

/**
 * Write the original on a mail the job has not held yet. A second open mail
 * of the project with the same original Message-ID throws the unique
 * violation of `uniq_inbound_mails_open_original`, which the caller reads as
 * a duplicate.
 */
export async function recordOriginalFields(mailId: string, fields: OriginalFields): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
}

/** Whether an entry of the project was filed from this original (a forward of it filed earlier). */
export async function isOriginalFiled(projectId: string, originalMessageId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: mailThreadEntries.id })
    .from(mailThreadEntries)
    .where(and(eq(mailThreadEntries.projectId, projectId), eq(mailThreadEntries.authorMessageId, originalMessageId)))
    .limit(1)
  return row !== undefined
}
