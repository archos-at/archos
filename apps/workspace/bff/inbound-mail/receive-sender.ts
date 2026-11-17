import 'server-only'
import { v5 as uuidv5 } from 'uuid'
import { captureServer } from '@/lib/analytics/posthog-server'
import { DOCUMENT_WRITE_PERMISSIONS } from '@/lib/authz/folder-access-rule'
import { userHoldsProjectPermissionStrict } from '@/lib/authz/project-membership'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { enqueueJobIfAbsent } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { announceHeld, announceWaiting } from './announce'
import {
  INBOUND_MAIL_EXTERNAL_WAIT_DAYS,
  INBOUND_MAIL_WAIT_DAYS,
  type InboundMailSenderClass,
  type SenderFlag,
} from './inbound-mail-vocabulary'
import { directFilingEnabled } from './direct-filing'
import { DependencyFaultError } from './receive-faults'
import { findMailForReceive } from './receive-repository'
import type { SenderVerdict } from './sender-auth'
import { senderClassOf } from './sender-class'

export function inboundMailJobId(kind: 'suggest' | 'follow' | 'sender', mailId: string): string {
  return uuidv5(`grid:inbound-mail:${kind}:${mailId}`, uuidv5.URL)
}

export async function classified(
  mail: InboundMailRow,
  verdict: SenderVerdict,
  flags: readonly SenderFlag[],
  automatic: boolean,
  degraded: boolean,
): Promise<{ senderClass: InboundMailSenderClass; expiresAt: Date; senderFlags: SenderFlag[] }> {
  const writes = verdict.senderUserId ? await writesInProject(mail, verdict.senderUserId, degraded) : false
  const senderFlags = [...new Set<SenderFlag>([...flags, ...(writes === null ? (['sender_unchecked'] as const) : [])])]
  const senderClass = senderClassOf({
    trust: verdict.trust,
    reason: verdict.reason,
    senderUserId: verdict.senderUserId,
    flags: senderFlags,
    automatic,
    writes: writes === true,
  })
  const outsider = senderClass === 'external' && !senderFlags.includes('sender_unchecked')
  const days = outsider ? INBOUND_MAIL_EXTERNAL_WAIT_DAYS : INBOUND_MAIL_WAIT_DAYS
  return { senderClass, expiresAt: new Date(new Date(mail.receivedAt).getTime() + days * 86_400_000), senderFlags }
}

async function writesInProject(mail: InboundMailRow, userId: string, degraded: boolean): Promise<boolean | null> {
  try {
    for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
      if (await userHoldsProjectPermissionStrict({ organizationId: mail.organizationId }, mail.projectId, userId, permission)) return true
    }
    return false
  } catch (error) {
    if (!degraded) throw new DependencyFaultError('write_check', error)
    return null
  }
}

export async function announceHeldMail(mail: InboundMailRow & { senderTrust: NonNullable<InboundMailRow['senderTrust']> }): Promise<void> {
  const facts = {
    organizationId: mail.organizationId,
    projectId: mail.projectId,
    mailId: mail.id,
    senderTrust: mail.senderTrust,
    senderUserId: mail.senderUserId,
    senderFlags: mail.senderFlags,
    automatic: mail.automatic,
  }
  await announceWaiting(facts)
  await announceHeld({ ...facts, senderClass: mail.senderClass })
}

export async function queueSenderFiling(mail: Pick<InboundMailRow, 'id' | 'organizationId' | 'projectId'>): Promise<void> {
  if (!directFilingEnabled()) return leaveForTheWriters(mail.id)
  await enqueueJobIfAbsent({
    kind: 'inbound_mail_sender_file',
    organizationId: mail.organizationId,
    priority: BFF_JOB_PRIORITY.interactive,
    jobId: inboundMailJobId('sender', mail.id),
    payload: { mailId: mail.id, projectId: mail.projectId, waits: 0 },
  })
}

async function leaveForTheWriters(mailId: string): Promise<void> {
  const mail = await findMailForReceive(mailId)
  if (!mail?.senderTrust || mail.status !== 'waiting') return
  // oxlint-disable-next-line no-console -- the operator's trail, as the sender's filing logs each end
  console.info(`[inbound-mail] sender filing of mail ${mail.id}: waits:direct_filing_off (not queued)`)
  captureServer({
    event: 'inbound_mail_sender_filed',
    distinctId: null,
    organizationId: mail.organizationId,
    properties: { outcome: 'waits', reason: 'direct_filing_off', waits_for_suggestion: 0 },
  })
  await announceHeldMail({ ...mail, senderTrust: mail.senderTrust })
}
