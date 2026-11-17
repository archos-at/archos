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
import { recordReread, type UnreadText } from './sweep-repository'

export type RereadOutcome = 'read' | 'later' | 'gone'

export async function rereadHeldText(mail: UnreadText, timeoutMs: number): Promise<RereadOutcome> {
  const domain = inboundMailDomain()
  if (!domain) throw new Error('INBOUND_MAIL_DOMAIN is not set: a held mail cannot be read')
  const read = await readAgain(mail, timeoutMs)
  if (!read) return 'later'

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
  if (mail.senderClass === 'verified_writer') await queueSenderFiling(mail)
  return 'read'
}

async function readAgain(mail: UnreadText, timeoutMs: number): Promise<MailRead | null> {
  try {
    return await readMail(await stagedObjectUrlForBackend(mail.stagingBucket, mail.rawStorageKey), timeoutMs)
  } catch (error) {
    if (error instanceof MailReadRefusedError) return unreadableRead('failed')
    console.warn(`[inbound-mail] the reader did not answer for mail ${mail.id} again; its text waits unread`)
    return null
  }
}
