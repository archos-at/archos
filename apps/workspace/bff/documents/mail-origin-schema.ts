import { z } from 'zod'
import { SENDER_TRUSTS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'

export const mailOriginViewSchema = z.object({
  threadId: z.string(),
  entryId: z.string(),
  sentAt: z.string(),
  receivedAt: z.string(),
  fromName: z.string().nullable(),
  forwardedByName: z.string().nullable(),
  forwarded: z.boolean(),
  signerDomain: z.string().nullable(),
  senderTrust: z.enum(SENDER_TRUSTS),
})
mailOriginViewSchema satisfies z.ZodType<MailOriginView>
