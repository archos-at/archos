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
import { DOCUMENT_WRITE_PERMISSIONS } from '@/lib/authz/folder-access-rule'
import { userHoldsProjectPermission } from '@/lib/authz/project-membership'
import type { InboundMailRow } from '@/lib/db/schema/inbound-mail'
import { insertJobIfAbsent } from '@/lib/jobs-queue/repository'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { announceHeld, announceWaiting } from './announce'
import {
  INBOUND_MAIL_EXTERNAL_WAIT_DAYS,
  INBOUND_MAIL_WAIT_DAYS,
  type InboundMailSenderClass,
  type SenderFlag,
} from './inbound-mail-vocabulary'
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
 * none), and an outsider's shorter wait. A check that fails reads as no write
 * right: the mail then waits for the project's writers instead of filing.
 */
export async function classified(
  mail: InboundMailRow,
  verdict: SenderVerdict,
  flags: readonly SenderFlag[],
  automatic: boolean,
): Promise<{ senderClass: InboundMailSenderClass; expiresAt: Date }> {
  const writes = verdict.senderUserId ? await writesInProject(mail, verdict.senderUserId) : false
  const senderClass = senderClassOf({ trust: verdict.trust, reason: verdict.reason, senderUserId: verdict.senderUserId, flags, automatic, writes })
  const days = senderClass === 'external' ? INBOUND_MAIL_EXTERNAL_WAIT_DAYS : INBOUND_MAIL_WAIT_DAYS
  return { senderClass, expiresAt: new Date(new Date(mail.receivedAt).getTime() + days * 86_400_000) }
}

async function writesInProject(mail: InboundMailRow, userId: string): Promise<boolean> {
  for (const permission of DOCUMENT_WRITE_PERMISSIONS) {
    const holds = await userHoldsProjectPermission({ organizationId: mail.organizationId }, mail.projectId, userId, permission).catch(() => false)
    if (holds) return true
  }
  return false
}

/**
 * A held mail that is not filed directly: its waiting row (the sender per D9,
 * else the managers), and the member it names hears why it waits.
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
 */
export async function queueSenderFiling(mail: InboundMailRow): Promise<void> {
  await insertJobIfAbsent({
    kind: 'inbound_mail_sender_file',
    organizationId: mail.organizationId,
    priority: BFF_JOB_PRIORITY.interactive,
    jobId: inboundMailJobId('sender', mail.id),
    payload: { mailId: mail.id, projectId: mail.projectId, waits: 0 },
  })
}
