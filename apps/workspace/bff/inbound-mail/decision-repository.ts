import 'server-only'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbTransaction } from '@/lib/db/executor'
import { inboundMailDecisions, inboundMailParts, inboundMails, type InboundMailDecisionRow, type InboundMailPartRow, type InboundMailRow, type NewInboundMailDecisionRow } from '@/lib/db/schema/inbound-mail'
import { enqueueJobIfAbsent } from '@/lib/jobs-queue/enqueue'
import { BFF_JOB_PRIORITY } from '@/lib/jobs-queue/types'
import { findMailParts, OPEN_PART_STATES } from './review-read-repository'

export class MailChangedError extends Error {
  constructor(readonly mailId: string) {
    super(`inbound mail ${mailId} changed since it was read`)
    this.name = 'MailChangedError'
  }
}

export class PartNotWaitingError extends Error {
  constructor(readonly mailId: string) {
    super(`a part of inbound mail ${mailId} is no longer waiting`)
    this.name = 'PartNotWaitingError'
  }
}

export interface MailDecisionWrite {
  mailId: string
  ifMatch: string
  files: NewInboundMailDecisionRow[]
  keepOthers?: boolean
}

export interface DecisionActor {
  decidedBy: string
  via: 'app' | 'agent' | 'agent_proposal' | 'sender' | 'follow'
  proposalId: string | null
}

export interface FilingJob {
  jobId: string
  organizationId: string
  payload: Record<string, unknown>
}

export interface DecisionsWritten {
  decisions: InboundMailDecisionRow[]
}

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
    for (const write of [...writes].sort((a, b) => (a.mailId < b.mailId ? -1 : a.mailId > b.mailId ? 1 : 0))) {
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
      const others = write.keepOthers ? [] : parts.filter((part) => part.state === 'waiting' && !filed.has(part.id))
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

export async function dismissMails(projectId: string, mailIds: readonly string[], actor: DecisionActor): Promise<DecisionsWritten> {
  return getDb().transaction(async (tx) => {
    const now = new Date()
    const decisions: InboundMailDecisionRow[] = []
    for (const mailId of [...new Set(mailIds)].sort()) {
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

export function isRestorable(
  mail: Pick<InboundMailRow, 'status'>,
  part: Pick<InboundMailPartRow, 'state' | 'kind' | 'endedAt' | 'storageKey'>,
  restorableAfter: Date,
): boolean {
  return (
    mail.status === 'waiting' &&
    (part.state === 'dismissed' || part.state === 'expired') &&
    part.endedAt !== null &&
    new Date(part.endedAt) > restorableAfter &&
    (part.kind === 'message' || part.storageKey !== null)
  )
}

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
    const restorable = (await findMailParts([mailId], tx)).filter((part) => isRestorable(mail, part, restorableAfter))
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
    await tx
      .update(inboundMails)
      .set({ expiresAt, expiringNotifiedAt: null, updatedAt: now })
      .where(eq(inboundMails.id, mailId))
    return { decisions }
  })
}

export async function markDecisionsAudited(decisionIds: readonly string[], at: Date = new Date()): Promise<void> {
  if (decisionIds.length === 0) return
  await getDb()
    .update(inboundMailDecisions)
    .set({ auditedAt: at })
    .where(and(inArray(inboundMailDecisions.id, [...decisionIds]), isNull(inboundMailDecisions.auditedAt)))
}

export async function findPartKinds(partIds: readonly string[]): Promise<Map<string, 'message' | 'attachment'>> {
  if (partIds.length === 0) return new Map()
  const rows = await getDb()
    .select({ id: inboundMailParts.id, kind: inboundMailParts.kind })
    .from(inboundMailParts)
    .where(inArray(inboundMailParts.id, [...partIds]))
    .limit(partIds.length)
  return new Map(rows.map((row) => [row.id, row.kind]))
}

export async function hasOpenParts(mailId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: inboundMailParts.id })
    .from(inboundMailParts)
    .where(and(eq(inboundMailParts.mailId, mailId), inArray(inboundMailParts.state, [...OPEN_PART_STATES])))
    .limit(1)
  return Boolean(row)
}

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
