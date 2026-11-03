/**
 * SQL for a person's decisions on a mail's parts (ADR-0137): filing,
 * dismissing and restoring them, their audit, and the agent's suggestion a
 * decision may follow (D21).
 *
 * No authorization here: the service decides who may ask, and row-level
 * security is the backstop. Every list is bounded. The rules a row must keep
 * are CHECKs in the migration (`./repository.ts`).
 */

import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbTransaction } from '@/lib/db/executor'
import { inboundMailDecisions, inboundMailParts, inboundMails, type InboundMailDecisionRow, type InboundMailPartRow, type InboundMailRow, type NewInboundMailDecisionRow } from '@/lib/db/schema/inbound-mail'
import { enqueueJobIfAbsent } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { findMailParts, OPEN_PART_STATES } from './review-read-repository'

/** The mail changed since the person read it: their `ifMatch` no longer names it (C3). */
export class MailChangedError extends Error {
  constructor(readonly mailId: string) {
    super(`inbound mail ${mailId} changed since it was read`)
    this.name = 'MailChangedError'
  }
}

/** A part a decision named is no longer waiting: someone else decided first (C3). */
export class PartNotWaitingError extends Error {
  constructor(readonly mailId: string) {
    super(`a part of inbound mail ${mailId} is no longer waiting`)
    this.name = 'PartNotWaitingError'
  }
}

/** One mail's decision as the transaction writes it. */
export interface MailDecisionWrite {
  mailId: string
  /** The token the person read the mail at; checked against the rows under the lock. */
  ifMatch: string
  /** The `file` decisions, one per part filed, ids assigned by the caller. */
  files: NewInboundMailDecisionRow[]
}

/** Who decided and how, the same for every row of one request. */
export interface DecisionActor {
  decidedBy: string
  via: 'app' | 'agent' | 'agent_proposal'
  proposalId: string | null
}

/** A filing job to queue in the same transaction as the decisions it reads. */
export interface FilingJob {
  jobId: string
  organizationId: string
  payload: Record<string, unknown>
}

/** What the transaction wrote, per mail: every decision row (file and dismiss). */
export interface DecisionsWritten {
  decisions: InboundMailDecisionRow[]
}

/**
 * Write one request's decisions (D26), all or nothing:
 *
 * 1. Lock each mail (`FOR UPDATE`) and refuse one whose `ifMatch`, recomputed
 *    from the rows under the lock by `ifMatchOf`, is not the one the person
 *    read ({@link MailChangedError}).
 * 2. Insert the `file` decisions, then claim each filed part `waiting →
 *    filing` with its own decision (compare-and-set: a part another request
 *    claimed first is {@link PartNotWaitingError}).
 * 3. Dismiss every other waiting part of the mail, each with a `dismiss`
 *    decision: a request decides the whole mail.
 * 4. Queue the filing job, in the same transaction, so a claimed part always
 *    has the job that files it and a job never reads a decision that is not there.
 *
 * The database holds the rest: a claim needs a `file` decision about that very
 * part, a clean scan, a person's id (migration 0194).
 */
export async function writeMailDecisions(
  writes: readonly MailDecisionWrite[],
  actor: DecisionActor,
  ifMatchOf: (mail: InboundMailRow, parts: readonly InboundMailPartRow[]) => string,
  claimExpiresAt: Date,
  job: FilingJob | null,
): Promise<DecisionsWritten> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const decisions: InboundMailDecisionRow[] = []
    for (const write of writes) {
      const [mail] = await tx.select().from(inboundMails).where(eq(inboundMails.id, write.mailId)).for('update').limit(1)
      if (!mail || mail.status !== 'waiting') throw new MailChangedError(write.mailId)
      const parts = await findMailParts([write.mailId], tx)
      if (ifMatchOf(mail, parts) !== write.ifMatch) throw new MailChangedError(write.mailId)

      if (write.files.length > 0) decisions.push(...(await tx.insert(inboundMailDecisions).values([...write.files]).returning()))
      for (const decision of write.files) {
        const claimed = await tx
          .update(inboundMailParts)
          .set({ state: 'filing', decisionId: decision.id, claimExpiresAt, lastFailure: null, updatedAt: now })
          .where(and(eq(inboundMailParts.id, decision.partId), eq(inboundMailParts.mailId, write.mailId), eq(inboundMailParts.state, 'waiting')))
          .returning({ id: inboundMailParts.id })
        if (claimed.length !== 1) throw new PartNotWaitingError(write.mailId)
      }

      const filed = new Set(write.files.map((decision) => decision.partId))
      const others = parts.filter((part) => part.state === 'waiting' && !filed.has(part.id))
      decisions.push(...(await dismissParts(tx, mail, others, actor, now)))
      await tx.update(inboundMails).set({ updatedAt: now }).where(eq(inboundMails.id, write.mailId))
    }
    if (job) {
      await enqueueJobIfAbsent(
        { kind: 'inbound_mail_file', organizationId: job.organizationId, priority: BFF_JOB_PRIORITY.interactive, jobId: job.jobId, payload: job.payload },
        tx,
      )
    }
    return { decisions }
  })
}

/** Dismiss these waiting parts of `mail`, each with its `dismiss` decision. */
async function dismissParts(
  tx: DbTransaction,
  mail: InboundMailRow,
  parts: readonly InboundMailPartRow[],
  actor: DecisionActor,
  now: Date,
): Promise<InboundMailDecisionRow[]> {
  if (parts.length === 0) return []
  const rows = await tx
    .insert(inboundMailDecisions)
    .values(parts.map((part) => decisionRow(mail, part.id, 'dismiss', actor, now)))
    .returning()
  const dismissed = await tx
    .update(inboundMailParts)
    .set({ state: 'dismissed', endedAt: now, updatedAt: now })
    .where(and(inArray(inboundMailParts.id, parts.map((part) => part.id)), eq(inboundMailParts.state, 'waiting')))
    .returning({ id: inboundMailParts.id })
  if (dismissed.length !== parts.length) throw new PartNotWaitingError(mail.id)
  return rows
}

function decisionRow(
  mail: Pick<InboundMailRow, 'id' | 'organizationId' | 'projectId'>,
  partId: string,
  action: 'dismiss' | 'restore',
  actor: DecisionActor,
  now: Date,
): NewInboundMailDecisionRow {
  return {
    organizationId: mail.organizationId,
    projectId: mail.projectId,
    mailId: mail.id,
    partId,
    action,
    decidedBy: actor.decidedBy,
    via: actor.via,
    proposalId: actor.proposalId,
    decidedAt: now,
  }
}

/**
 * Dismiss every waiting part of these mails (`inbound-mail-dismiss`), each with
 * its decision. A mail that is not waiting, or has nothing waiting, is skipped:
 * dismissing twice changes nothing. Parts being filed are left to their job.
 */
export async function dismissMails(projectId: string, mailIds: readonly string[], actor: DecisionActor): Promise<DecisionsWritten> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const decisions: InboundMailDecisionRow[] = []
    for (const mailId of mailIds) {
      const [mail] = await tx
        .select()
        .from(inboundMails)
        .where(and(eq(inboundMails.id, mailId), eq(inboundMails.projectId, projectId)))
        .for('update')
        .limit(1)
      if (!mail || mail.status !== 'waiting') continue
      const waiting = (await findMailParts([mailId], tx)).filter((part) => part.state === 'waiting')
      if (waiting.length === 0) continue
      decisions.push(...(await dismissParts(tx, mail, waiting, actor, now)))
      await tx.update(inboundMails).set({ updatedAt: now }).where(eq(inboundMails.id, mailId))
    }
    return { decisions }
  })
}

/**
 * Restore a mail's dismissed and expired parts that are still within their
 * seven days (D8): each waits again, with a `restore` decision. Only while the
 * mail itself is held (a settled mail is scrubbed and cannot be shown again);
 * an attachment only while its bytes are there. A restored expired mail waits
 * at least seven more days. Empty when there was nothing to restore, which
 * makes a repeated call a no-op.
 */
export async function restoreMailParts(
  projectId: string,
  mailId: string,
  actor: DecisionActor,
  restorableAfter: Date,
  waitsUntilAtLeast: Date,
): Promise<DecisionsWritten> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const [mail] = await tx
      .select()
      .from(inboundMails)
      .where(and(eq(inboundMails.id, mailId), eq(inboundMails.projectId, projectId)))
      .for('update')
      .limit(1)
    if (!mail || mail.status !== 'waiting') return { decisions: [] }
    const restorable = (await findMailParts([mailId], tx)).filter(
      (part) =>
        (part.state === 'dismissed' || part.state === 'expired') &&
        part.endedAt !== null &&
        new Date(part.endedAt) > restorableAfter &&
        (part.kind === 'message' || part.storageKey !== null),
    )
    if (restorable.length === 0) return { decisions: [] }
    const decisions = await tx
      .insert(inboundMailDecisions)
      .values(restorable.map((part) => decisionRow(mail, part.id, 'restore', actor, now)))
      .returning()
    await tx
      .update(inboundMailParts)
      .set({ state: 'waiting', endedAt: null, updatedAt: now })
      .where(and(inArray(inboundMailParts.id, restorable.map((part) => part.id)), inArray(inboundMailParts.state, ['dismissed', 'expired'])))
    const expiresAt = new Date(Math.max(new Date(mail.expiresAt).getTime(), waitsUntilAtLeast.getTime()))
    await tx.update(inboundMails).set({ expiresAt, updatedAt: now }).where(eq(inboundMails.id, mailId))
    return { decisions }
  })
}

/** These decisions reached the audit trail (`audited_at`, once); sweep 11 sends the rest. */
export async function markDecisionsAudited(decisionIds: readonly string[], at: Date = new Date()): Promise<void> {
  if (decisionIds.length === 0) return
  await getDb()
    .update(inboundMailDecisions)
    .set({ auditedAt: at })
    .where(and(inArray(inboundMailDecisions.id, [...decisionIds]), isNull(inboundMailDecisions.auditedAt)))
}

/** The parts' kinds, for the audit lines of their decisions. */
export async function findPartKinds(partIds: readonly string[]): Promise<Map<string, 'message' | 'attachment'>> {
  if (partIds.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: inboundMailParts.id, kind: inboundMailParts.kind })
    .from(inboundMailParts)
    .where(inArray(inboundMailParts.id, [...partIds]))
    .limit(partIds.length)
  return new Map(rows.map((row) => [row.id, row.kind]))
}

/** Whether any part of the mail still waits for a person (or is being filed). */
export async function hasOpenParts(mailId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: inboundMailParts.id })
    .from(inboundMailParts)
    .where(and(eq(inboundMailParts.mailId, mailId), inArray(inboundMailParts.state, [...OPEN_PART_STATES])))
    .limit(1)
  return Boolean(row)
}

// ---------------------------------------------------------------------------
// The suggest job (The agent's suggestion, D21)
// ---------------------------------------------------------------------------

/**
 * Store the agent's suggestion on the parts it placed, with the generation's
 * trace. Only a part that still waits takes one: a person who decided in the
 * meantime decided without it, and the suggestion would name a file whose
 * bytes may be gone (`inbound_mail_parts_suggestion_with_bytes`). The number
 * of parts that took one.
 *
 * `updated_at` is left alone on purpose: it is part of the mail's `ifMatch`
 * (`mailIfMatch`), and a suggestion arriving while a person reads the mail must
 * not make their decision stale. It advises; it changes nothing they decide on.
 */
export async function storePartSuggestions(
  mailId: string,
  suggestions: ReadonlyMap<string, Record<string, unknown>>,
  traceId: string | null,
): Promise<number> {
  let stored = 0
  for (const [partId, suggestion] of suggestions) {
    const rows = await getDb()
      .update(inboundMailParts)
      .set({ suggestion, suggestionTraceId: traceId })
      .where(and(eq(inboundMailParts.id, partId), eq(inboundMailParts.mailId, mailId), eq(inboundMailParts.state, 'waiting')))
      .returning({ id: inboundMailParts.id })
    stored += rows.length
  }
  return stored
}
