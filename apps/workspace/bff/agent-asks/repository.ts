/**
 * The SQL of the asks (ADR-0124, migration 0179). Every read is one row or a
 * bounded list; every write states the organization and runs in its tenant
 * scope, so row-level security is the backstop and not the plan.
 */

import 'server-only'
import { and, asc, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { documentVersions } from '@/lib/db/schema/document-versions'
import { documents } from '@/lib/db/schema/documents'
import { messages } from '@/lib/db/schema/messages'
import { agentAsks, type AgentAskRow } from '@/lib/db/schema/piloti-asks'
import { withTenant } from '@/lib/db/tenant-context'
import { documentVisibleTo, type DocumentReader } from '@/lib/documents/visibility'
import { ASK_LIFECYCLE, type AskDocument, type AskState } from './ask-wire'

/** The most documents one answer lists; a turn that filed more is an outlier, and the conversation shows them all. */
export const ASK_DOCUMENT_LIMIT = 20

/** The bound of a reason, as the table's CHECK states it. */
const MAX_REASON_CHARS = 500

const clipReason = (reason: string): string => {
  const flat = reason.replace(/\s+/g, ' ').trim() || 'no reason given'
  return flat.length <= MAX_REASON_CHARS ? flat : `${flat.slice(0, MAX_REASON_CHARS - 1)}…`
}

export async function insertAsk(values: {
  id: string
  organizationId: string
  conversationId: string
  requestedBy: string
}): Promise<AgentAskRow> {
  const db = getDb()
  const [row] = await withTenant({ organizationId: values.organizationId }, () =>
    db.insert(agentAsks).values(values).returning(),
  )
  if (!row) throw new Error('the ask was not recorded')
  return row
}

/** One ask of the organization, or null. */
export async function findAsk(organizationId: string, id: string): Promise<AgentAskRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(agentAsks)
      .where(and(eq(agentAsks.organizationId, organizationId), eq(agentAsks.id, id)))
      .limit(1),
  )
  return row ?? null
}

/**
 * An ask by its id alone, for the one caller that has no organization yet: the
 * turn's outcome names the turn (the ask's id), and the ask names the
 * organization. Run it under platform access, then do the rest as that tenant.
 */
export async function findAskById(id: string): Promise<AgentAskRow | null> {
  const db = getDb()
  const [row] = await db.select().from(agentAsks).where(eq(agentAsks.id, id)).limit(1)
  return row ?? null
}

/** How many open asks one expiry sweep reads by default, and the most it may ask for. */
export const OPEN_ASKS_PAGE = 200
export const MAX_OPEN_ASKS_PAGE = 1_000

/**
 * The asks of every organization still open that were asked before `before`,
 * oldest first and at most `limit` (clamped to 1..{@link MAX_OPEN_ASKS_PAGE}):
 * the expiry sweep's work. Run under platform access; each is then ended in its
 * own organization (`endAsk`). The partial index of migration 0230 serves it.
 */
export async function findAsksOpenBefore(
  before: Date,
  limit: number = OPEN_ASKS_PAGE,
): Promise<Array<Pick<AgentAskRow, 'id' | 'organizationId'>>> {
  const db = getDb()
  const bounded = Math.min(Math.max(1, Math.trunc(Number.isFinite(limit) ? limit : OPEN_ASKS_PAGE)), MAX_OPEN_ASKS_PAGE)
  return db
    .select({ id: agentAsks.id, organizationId: agentAsks.organizationId })
    .from(agentAsks)
    .where(and(inArray(agentAsks.state, [...ASK_LIFECYCLE.liveStates]), lt(agentAsks.createdAt, before)))
    .orderBy(asc(agentAsks.createdAt))
    .limit(bounded)
}

/** Whether `requestedBy` asked anything in `conversationId`: the test that a conversation may be continued by an ask. */
export async function hasAskedInConversation(
  organizationId: string,
  conversationId: string,
  requestedBy: string,
): Promise<boolean> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select({ id: agentAsks.id })
      .from(agentAsks)
      .where(
        and(
          eq(agentAsks.organizationId, organizationId),
          eq(agentAsks.conversationId, conversationId),
          eq(agentAsks.requestedBy, requestedBy),
        ),
      )
      .orderBy(desc(agentAsks.createdAt))
      .limit(1),
  )
  return row !== undefined
}

/**
 * Delete the question an ask wrote into a thread it continued, when its turn
 * never started: nobody will answer it, and the thread should not show it.
 * The message's id is the ask's.
 */
export async function deleteAskQuestion(organizationId: string, conversationId: string, askId: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .delete(messages)
      .where(
        and(
          eq(messages.organizationId, organizationId),
          eq(messages.conversationId, conversationId),
          eq(messages.id, askId),
        ),
      ),
  )
}

/** `submitted` to `working`, once the turn runs. False when the ask had moved on (its outcome came first). */
export async function markAskWorking(organizationId: string, id: string): Promise<boolean> {
  const db = getDb()
  const rows = await withTenant({ organizationId }, () =>
    db
      .update(agentAsks)
      .set({ state: 'working', updatedAt: new Date() })
      .where(and(eq(agentAsks.organizationId, organizationId), eq(agentAsks.id, id), inArray(agentAsks.state, [...ASK_LIFECYCLE.sourcesOf('start')])))
      .returning({ id: agentAsks.id }),
  )
  return rows.length > 0
}

/** How an ask ends. `failed` and `rejected` carry a user-safe reason. */
export type AskEnd =
  | { state: 'completed' | 'canceled' }
  | { state: 'failed' | 'rejected'; reason: string }

/**
 * Record an ask's final word, from `submitted` or `working`. The first final
 * word stands: the turn's outcome, a cancel and the start's own refusal cannot
 * overwrite each other. The row as ended, or null when it had already ended.
 */
export async function endAsk(organizationId: string, id: string, end: AskEnd): Promise<AgentAskRow | null> {
  const db = getDb()
  const now = new Date()
  const reason = 'reason' in end ? clipReason(end.reason) : null
  const open: AskState[] = [...ASK_LIFECYCLE.liveStates]
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(agentAsks)
      .set({ state: end.state, reason, endedAt: now, updatedAt: now })
      .where(and(eq(agentAsks.organizationId, organizationId), eq(agentAsks.id, id), inArray(agentAsks.state, open)))
      .returning(),
  )
  return row ?? null
}

/**
 * The documents Piloti filed in the ask's conversation while the ask ran, as
 * the person who asked: versions they filed (Piloti files in the asker's
 * session), from that conversation, between the ask's start and its end, and
 * only documents the reader may see (`documentVisibleTo`).
 */
export async function listAskDocuments(
  ask: Pick<AgentAskRow, 'organizationId' | 'conversationId' | 'requestedBy' | 'createdAt' | 'endedAt'>,
  reader: DocumentReader,
): Promise<AskDocument[]> {
  const db = getDb()
  const rows = await withTenant({ organizationId: ask.organizationId }, () =>
    db
      .select({
        documentId: documents.id,
        versionId: documentVersions.id,
        filename: documents.filename,
        displayName: documents.displayName,
        projectId: documents.projectId,
        contentType: documentVersions.contentType,
      })
      .from(documentVersions)
      .innerJoin(documents, eq(documents.id, documentVersions.documentId))
      .where(
        and(
          eq(documentVersions.organizationId, ask.organizationId),
          eq(documentVersions.originConversationId, ask.conversationId),
          eq(documentVersions.createdBy, ask.requestedBy),
          gte(documentVersions.createdAt, ask.createdAt),
          ...(ask.endedAt ? [lte(documentVersions.createdAt, ask.endedAt)] : []),
          documentVisibleTo(reader),
        ),
      )
      .orderBy(documentVersions.createdAt)
      .limit(ASK_DOCUMENT_LIMIT),
  )
  return rows.map((row) => ({
    documentId: row.documentId,
    versionId: row.versionId,
    name: row.displayName?.trim() || row.filename,
    projectId: row.projectId ?? null,
    contentType: row.contentType ?? null,
  }))
}
