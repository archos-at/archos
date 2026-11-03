/** The wire schema of a mail that brought a Fassung, for the version list (`./lifecycle-types.ts`). */

import { z } from 'zod'
import { SENDER_TRUSTS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'

/**
 * A mail that brought a Fassung (D36, `MailOriginView`): the E-Mail-Verlauf's
 * message (`threadId`, `entryId`, for `mail-thread-get`), when it was sent and
 * received, the sender's display name, the signing domain and how far the
 * sender was confirmed. Never an address.
 */
export const mailOriginViewSchema = z.object({
  threadId: z.string(),
  entryId: z.string(),
  sentAt: z.string(),
  receivedAt: z.string(),
  fromName: z.string().nullable(),
  signerDomain: z.string().nullable(),
  senderTrust: z.enum(SENDER_TRUSTS),
})
mailOriginViewSchema satisfies z.ZodType<MailOriginView>
