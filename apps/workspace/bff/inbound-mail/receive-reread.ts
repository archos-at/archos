/**
 * Sweep 15's step (`./sweep.ts`): the text of a held mail that the Python
 * reader did not answer for, read again while the mail waits (ADR-0137; B3 of
 * the 2026-11 ship review).
 *
 * The receive job waits a reader outage out for about six hours
 * (`./receive-faults.ts`). Past that it holds the mail with its text
 * unreadable and `reader_fault_at` set, so the mail, its sender's class and
 * its attachments are there while the reader is down. Without this step that
 * text stayed unreadable for good: never filed, never appended, only the
 * `.eml` to download. A text the reader read and found unreadable (too large,
 * a parser timeout, a refusal) has no `reader_fault_at` and is never read
 * again.
 *
 * Each run reads the raw message again, redacts other projects' addresses
 * (B8) and runs the content check, as the receive job does (steps 8 and 9),
 * then writes `read.json` and the text part in one compare-and-set: a person
 * who decided the text in between wins. A verified writer's mail gets its
 * sender's filing queued again, by the job's name only, since the text it
 * could not file before can go now. Receive side: no filing code
 * (`review-first.spec.ts`).
 */

import 'server-only'
import { createHash } from 'node:crypto'
import { publishProjectChanged } from '@/lib/realtime/door-events'
import { inboundMailDomain, redactProjectAddresses } from './address'
import { inboundMailStagingKey } from './inbound-mail-vocabulary'
import { MailReadRefusedError, readMail, redactRead, unreadableRead, type MailRead } from './read-client'
import { findAddressToken } from './repository'
import { queueSenderFiling } from './receive-sender'
import { mailScreeningFor } from './screening'
import { putStagedObject, stagedObjectUrlForBackend } from './staging'
import { postponeReread, recordReread, type UnreadText } from './sweep-repository'

/** What one re-read came to. */
export type RereadOutcome = 'read' | 'later' | 'gone'

/** Read one mail's text again (see the module header). Throws for the sweep to count a fault of the store or the database. */
export async function rereadHeldText(mail: UnreadText, now: Date): Promise<RereadOutcome> {
  const domain = inboundMailDomain()
  if (!domain) throw new Error('INBOUND_MAIL_DOMAIN is not set: a held mail cannot be read')
  const read = await readAgain(mail)
  if (!read) return (await postponeReread(mail, now)) ? 'later' : 'gone'

  const token = await findAddressToken(mail.addressId)
  const redacted = redactRead(read, (text) => redactProjectAddresses(text, domain, token))
  const screening = await mailScreeningFor(mail.organizationId, mail.projectId)
  const readStorageKey = inboundMailStagingKey({ organizationId: mail.organizationId, projectId: mail.projectId }, mail.id, 'read.json')
  await putStagedObject(mail.stagingBucket, readStorageKey, Buffer.from(JSON.stringify(redacted)), 'application/json')
  const recorded = await recordReread(mail, {
    readStorageKey,
    sha256: createHash('sha256').update(redacted.ownText, 'utf8').digest('hex'),
    sizeBytes: Buffer.byteLength(redacted.ownText),
    riskFlags: redacted.unreadable ? ['unreadable'] : [],
    contentFindings: [...screening.contentFindings(redacted.ownText)].slice(0, 32),
  })
  if (!recorded) return 'gone'
  publishProjectChanged(mail.organizationId, mail.projectId)
  // The text the sender's filing could not file is fileable now; the job decides, as that member.
  if (mail.senderClass === 'verified_writer') await queueSenderFiling(mail)
  return 'read'
}

/** The reader's answer, a refusal read as unreadable (permanent), or null when it did not answer again. */
async function readAgain(mail: UnreadText): Promise<MailRead | null> {
  try {
    return await readMail(await stagedObjectUrlForBackend(mail.stagingBucket, mail.rawStorageKey))
  } catch (error) {
    if (error instanceof MailReadRefusedError) return unreadableRead('failed')
    console.warn(`[inbound-mail] the reader did not answer for mail ${mail.id} again; its text waits unread`)
    return null
  }
}
