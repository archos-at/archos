/**
 * The receive job's part of the sender rule (ADR-0137, amendment of
 * 2026-11-03; `./receive-job.ts` steps 11 to 13): the class it writes with the
 * hold and the window that class gives, the sender's own filing it queues for
 * a verified writer's mail, and what it tells about every other mail.
 *
 * Receive side: it imports no filing code (`review-first.spec.ts`). The
 * sender's filing is queued by its kind's name and runs as the sender
 * (`./sender-file-job.ts`).
 */

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

/** The job ids of the jobs one mail queues: uuid5 of the kind and the mail, so a second enqueue is no second job. */
export function inboundMailJobId(kind: 'suggest' | 'follow' | 'sender', mailId: string): string {
  return uuidv5(`grid:inbound-mail:${kind}:${mailId}`, uuidv5.URL)
}

/**
 * Step 11's class (`./sender-class.ts`) and the window it gives: whether the
 * From's member may write in the project, asked of WorkOS as the person's
 * project access asks it (any of `DOCUMENT_WRITE_PERMISSIONS`, a closed project
 * none), and an outsider's shorter wait.
 *
 * A write check WorkOS does not answer is a fault (`./receive-faults.ts`), never
 * a "no": the job tries again later, and only `degraded` (its budget spent)
 * holds the mail without the answer, flagged `sender_unchecked`, for the
 * project's writers. A `sender_unchecked` mail waits the full 30 days even when
 * no member could be named: it may be a member's (migration 0199 holds it).
 * The flags it returns are the ones to store.
 */
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

/** Whether the member may write in the project; null when WorkOS did not answer and the budget is spent. */
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

/**
 * A held mail that is not filed directly: its waiting row (the sender per D9
 * when they may write here, else the project's writers), and the member it
 * names hears why it waits.
 */
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

/**
 * A verified writer's mail (rule 1): queued by the job's name, never imported,
 * so the receive side stays free of filing code (`review-first.spec.ts`). The
 * job runs as the sender, re-checks their rights and files as them, or leaves
 * the mail waiting and says so (`./sender-file-job.ts`).
 *
 * With direct filing switched off (`./direct-filing.ts`) nothing is queued:
 * the mail keeps its class and waits for any of the project's writers (wait
 * reason `paused`), announced as any held mail is, and the run is counted as
 * the sender's filing would count it (`inbound_mail_sender_filed`, `waits`,
 * `direct_filing_off`).
 */
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

/** Direct filing is off: the verified writer's mail waits for the project's writers, and they hear so. */
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
