import 'server-only'
import { and, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMails, type InboundMailRow } from '@/lib/db/schema/inbound-mail'

export type OriginalFields = Pick<
  InboundMailRow,
  | 'originalAuthorAddress'
  | 'originalAuthorName'
  | 'originalSentAt'
  | 'originalSubject'
  | 'originalMessageId'
  | 'originalSource'
>

export async function recordOriginalFields(mailId: string, fields: OriginalFields): Promise<void> {
  await getDb()
    .update(inboundMails)
    .set({ ...fields, updatedAt: new Date() })
    .where(and(eq(inboundMails.id, mailId), eq(inboundMails.status, 'received')))
}
