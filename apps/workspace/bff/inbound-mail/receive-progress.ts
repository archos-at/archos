/**
 * What a receive run learned that the next run of the same mail reuses
 * (`receive_progress`, migration 0199; R10 of the second 2026-11 ship review).
 *
 * A dependency fault gives the claim back for up to eleven waits
 * (`./receive-faults.ts`), and each run used to authenticate the sender and
 * scan every attachment again: up to eleven times the ClamAV load through a
 * reader outage, and a DKIM pass that a later run could turn into a DNS
 * timeout. A run that faults now keeps, on the row, before it gives the claim
 * back:
 *
 * - the sender's authentication, unless its reason is transient (DNS that
 *   failed or did not answer is asked again);
 * - each attachment's scan, by the SHA-256 of its bytes, unless it `failed`
 *   (scanned again: a failed scan is no verdict).
 *
 * Only a `received` mail carries it: holding or dropping the mail clears it
 * (CHECK `inbound_mails_receive_progress_received`). A value this module
 * cannot read is no progress, and the run asks everything again.
 */

import { z } from 'zod'
import { inPool } from '@/lib/utils/in-pool'
import { MALWARE_SCAN_STATUSES, SENDER_REASONS } from './inbound-mail-vocabulary'
import type { MailAttachment } from './mime'
import type { StoredScan } from './repository'
import { isTransientReason, type SenderAuthentication } from './sender-auth'

const storedScanSchema = z.object({
  status: z.enum(MALWARE_SCAN_STATUSES).exclude(['pending']),
  engine: z.string().nullable(),
  signature: z.string().nullable(),
  scannedAt: z.coerce.date(),
})

const authenticationSchema = z.object({
  fromAddress: z.string().nullable(),
  fromDomain: z.string().nullable(),
  verified: z.boolean(),
  reason: z.enum(SENDER_REASONS),
  signerDomain: z.string().nullable(),
  signedHeaders: z.array(z.string()),
  signedRecipientNamesProject: z.boolean(),
  authenticationResults: z.string(),
})

const receiveProgressSchema = z.object({
  authentication: authenticationSchema.optional(),
  scans: z.record(z.string().regex(/^[0-9a-f]{64}$/), storedScanSchema).optional(),
})

/** What the runs of one mail have learned so far (see the module header). Mutable: a run adds to it. */
export type ReceiveProgress = z.infer<typeof receiveProgressSchema>

/** The progress a row holds, or none when it holds nothing this module can read. */
export function progressOf(stored: unknown): ReceiveProgress {
  const parsed = receiveProgressSchema.safeParse(stored ?? {})
  return parsed.success ? parsed.data : {}
}

/** The sender's authentication an earlier run reached, unless it was transient. */
export function reusableAuthentication(progress: ReceiveProgress): SenderAuthentication | null {
  const stored = progress.authentication
  return stored && !isTransientReason(stored.reason) ? stored : null
}

/** Keep the sender's authentication for a later run, unless it is transient. */
export function rememberAuthentication(progress: ReceiveProgress, authentication: SenderAuthentication): void {
  if (!isTransientReason(authentication.reason)) progress.authentication = authentication
}

/**
 * Scan each attachment, at most `inFlight` at once, reusing the verdict an
 * earlier run of this mail reached for the same bytes unless it failed; every
 * new verdict is kept in `progress`. In the attachments' order.
 */
export async function scanAttachments(
  attachments: readonly MailAttachment[],
  progress: ReceiveProgress,
  inFlight: number,
  scan: (bytes: Uint8Array) => Promise<StoredScan>,
): Promise<StoredScan[]> {
  const scans = (progress.scans ??= {})
  return inPool(attachments, inFlight, async (attachment) => {
    const earlier = scans[attachment.sha256]
    if (earlier && earlier.status !== 'failed') return earlier
    const verdict = await scan(attachment.content)
    scans[attachment.sha256] = verdict
    return verdict
  })
}
