/** The wire schema of a mail that brought a Fassung, for the version list (`./lifecycle-types.ts`). */

import { z } from 'zod'
import { SENDER_TRUSTS } from '@/lib/inbound-mail/inbound-mail-vocabulary'
import type { MailOriginView } from '@/lib/inbound-mail/inbound-mail-wire'

/**
 * A mail that brought a Fassung (D36, `MailOriginView`): the E-Mail-Verlauf's
 * message (`threadId`, `entryId`, for `mail-thread-get`), when it was sent and
 * received, the display name the Verlauf's heading names (a forward's author)
 * and its forwarder's, the signing domain and how far the sender was
 * confirmed. Never an address.
 */
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
