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

export type ReceiveProgress = z.infer<typeof receiveProgressSchema>

export function progressOf(stored: unknown): ReceiveProgress {
  const parsed = receiveProgressSchema.safeParse(stored ?? {})
  return parsed.success ? parsed.data : {}
}

export function reusableAuthentication(progress: ReceiveProgress): SenderAuthentication | null {
  const stored = progress.authentication
  return stored && !isTransientReason(stored.reason) ? stored : null
}

export function rememberAuthentication(progress: ReceiveProgress, authentication: SenderAuthentication): void {
  if (!isTransientReason(authentication.reason)) progress.authentication = authentication
}

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
