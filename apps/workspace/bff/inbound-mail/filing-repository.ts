import 'server-only'

import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { inboundMailDecisions, inboundMailParts, inboundMails, type InboundMailDecisionRow, type InboundMailPartRow, type InboundMailRow } from '@/lib/db/schema/inbound-mail'
import type {
  InboundMailFilingFailure,
  InboundMailIgnoredCounts,
  InboundMailNotStaged,
} from './inbound-mail-vocabulary'
import type { StoredScan } from './repository'
import { byFilingOrder } from './thread-groups'

export interface FilingWork {
  mail: InboundMailRow
  parts: InboundMailPartRow[]
  decisions: Map<string, InboundMailDecisionRow>
}

export async function findFilingWork(
  projectId: string,
  mailIds: readonly string[]
): Promise<FilingWork[]> {
  const ids = [...new Set(mailIds)].slice(0, 20)
  if (ids.length === 0) return []
  const db = getDb()
  const mails = await db
    .select()
    .from(inboundMails)
    .where(
      and(
        eq(inboundMails.projectId, projectId),
        inArray(inboundMails.id, ids),
        eq(inboundMails.status, 'waiting')
      )
    )
    .limit(ids.length)
  if (mails.length === 0) return []
  const parts = await db
    .select()
    .from(inboundMailParts)
    .where(
      inArray(
        inboundMailParts.mailId,
        mails.map((mail) => mail.id)
      )
    )
    .orderBy(inboundMailParts.mailId, inboundMailParts.position)
    .limit(mails.length * 201)
  const decisionIds = parts.flatMap((part) => (part.decisionId ? [part.decisionId] : []))
  const decisions =
    decisionIds.length === 0
      ? []
      : await db
          .select()
          .from(inboundMailDecisions)
          .where(inArray(inboundMailDecisions.id, decisionIds))
          .limit(decisionIds.length)
  const byId = new Map(decisions.map((decision) => [decision.id, decision]))
  return [...mails].sort(byFilingOrder).map((mail) => {
    const own = parts.filter((part) => part.mailId === mail.id)
    const decided = new Map<string, InboundMailDecisionRow>()
    for (const part of own) {
      const decision = part.decisionId ? byId.get(part.decisionId) : undefined
      if (decision) decided.set(part.id, decision)
    }
    return { mail, parts: own, decisions: decided }
  })
}

const claimed = (partId: string, decisionId: string) =>
  and(
    eq(inboundMailParts.id, partId),
    eq(inboundMailParts.state, 'filing'),
    eq(inboundMailParts.decisionId, decisionId)
  )

export async function renewClaim(
  partId: string,
  decisionId: string,
  until: Date
): Promise<boolean> {
  const renewed = await getDb()
    .update(inboundMailParts)
    .set({ claimExpiresAt: until, updatedAt: new Date() })
    .where(claimed(partId, decisionId))
    .returning({ id: inboundMailParts.id })
  return renewed.length === 1
}

export async function recordFilingScan(
  partId: string,
  decisionId: string,
  scan: StoredScan
): Promise<void> {
  await getDb()
    .update(inboundMailParts)
    .set({
      scanStatus: scan.status,
      scanEngine: scan.engine,
      scanSignature: scan.signature,
      scannedAt: scan.scannedAt,
      updatedAt: new Date(),
    })
    .where(claimed(partId, decisionId))
}

export async function returnPartToWaiting(
  partId: string,
  decisionId: string,
  failure: InboundMailFilingFailure,
  scan: StoredScan | null = null
): Promise<boolean> {
  const returned = await getDb()
    .update(inboundMailParts)
    .set({
      state: 'waiting',
      decisionId: null,
      claimExpiresAt: null,
      lastFailure: failure,
      ...(scan
        ? {
            scanStatus: scan.status,
            scanEngine: scan.engine,
            scanSignature: scan.signature,
            scannedAt: scan.scannedAt,
          }
        : {}),
      updatedAt: new Date(),
    })
    .where(claimed(partId, decisionId))
    .returning({ id: inboundMailParts.id })
  return returned.length === 1
}

export async function markAttachmentFiled(
  partId: string,
  decisionId: string,
  filed: { documentId: string; versionId: string | null; erasureDeferred: boolean }
): Promise<boolean> {
  const now = new Date()
  const done = await getDb()
    .update(inboundMailParts)
    .set({
      state: 'filed',
      claimExpiresAt: null,
      filedAt: now,
      lastFailure: null,
      documentId: filed.documentId,
      documentVersionId: filed.versionId,
      ...(filed.erasureDeferred
        ? { erasureDeferredAt: now }
        : { storageKey: null, filename: null, suggestion: null }),
      updatedAt: now,
    })
    .where(claimed(partId, decisionId))
    .returning({ id: inboundMailParts.id })
  return done.length === 1
}

export async function projectIsHeld(projectId: string, organizationId: string): Promise<boolean> {
  const rows = await getDb().execute<{ held: boolean }>(
    sql`SELECT legal_hold_blocks('project', ${projectId}::text, ${organizationId}) AS held`
  )
  return Boolean(Array.from(rows)[0]?.held)
}

export function ignoredCounts(
  notStaged: readonly InboundMailNotStaged[],
  ignored: InboundMailIgnoredCounts
): InboundMailIgnoredCounts {
  const counts: InboundMailIgnoredCounts = { ...ignored }
  for (const item of notStaged) counts[item.reason] = (counts[item.reason] ?? 0) + 1
  return counts
}

export async function settleFiledMail(
  mail: InboundMailRow,
  erasureDeferred: boolean
): Promise<boolean> {
  const now = new Date()
  const settled = await getDb()
    .update(inboundMails)
    .set({
      status: 'settled',
      settledAt: now,
      senderAddress: null,
      senderName: null,
      subject: null,
      baseSubject: null,
      envelopeFrom: null,
      participants: [],
      participantDomains: [],
      notStaged: [],
      ignored: ignoredCounts(mail.notStaged, mail.ignored),
      ...(erasureDeferred
        ? { erasureDeferredAt: now }
        : // A raw message still moving to its entry's original is the move's to forget (sweep 13).
          { readStorageKey: null, ...(mail.originalMovePendingAt ? {} : { rawStorageKey: null }) }),
      updatedAt: now,
    })
    .where(
      and(
        eq(inboundMails.id, mail.id),
        eq(inboundMails.status, 'waiting'),
        sql`NOT EXISTS (SELECT 1 FROM ${inboundMailParts} p WHERE p.mail_id = ${inboundMails.id} AND p.state <> 'filed')`
      )
    )
    .returning({ id: inboundMails.id })
  return settled.length === 1
}

export async function findMailKeys(
  mailId: string
): Promise<Pick<
  InboundMailRow,
  'rawStorageKey' | 'readStorageKey' | 'originalMovePendingAt'
> | null> {
  const [row] = await getDb()
    .select({
      rawStorageKey: inboundMails.rawStorageKey,
      readStorageKey: inboundMails.readStorageKey,
      originalMovePendingAt: inboundMails.originalMovePendingAt,
    })
    .from(inboundMails)
    .where(and(eq(inboundMails.id, mailId), isNull(inboundMails.settledAt)))
    .limit(1)
  return row ?? null
}
