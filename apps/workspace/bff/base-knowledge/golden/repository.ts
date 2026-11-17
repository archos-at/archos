/**
 * The SQL of golden cases and golden runs (migration 0228). Platform-private:
 * every read and write here runs as the platform role and says why; the one
 * tenant read is the turn's cost, from the usage ledger of the organization
 * the run asked in.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { llmUsageEvents } from '@/lib/db/schema/budgets'
import { knowledgeGoldenCaseRevisions, knowledgeGoldenRunCases, knowledgeGoldenRuns } from '@/lib/db/schema/knowledge-golden'
import { knowledgeChangeRequests, knowledgeReleaseMoves } from '@/lib/db/schema/knowledge-platform'
import { knowledgeRecords, knowledgeRevisions } from '@/lib/db/schema/knowledge-records'
import { withPlatformAccess, withTenant } from '@/lib/db/tenant-context'
import type { GoldenCase, GoldenCaseResult } from '../wire/golden-case'

const REASON = 'platform base knowledge: golden cases and runs'

/** The most cases one run holds; a country's `full` set is 40 (design §4.6). */
export const MAX_RUN_CASES = 200

export type GoldenRunRow = typeof knowledgeGoldenRuns.$inferSelect
export type GoldenRunCaseRow = typeof knowledgeGoldenRunCases.$inferSelect

/** A golden case with the revision it was read at. */
export interface StoredGoldenCase {
  recordId: string
  revisionId: string
  golden: GoldenCase
}

const keyOf = (recordId: string) => recordId.replace(/^golden_case:/, '')

function toStored(row: typeof knowledgeGoldenCaseRevisions.$inferSelect): StoredGoldenCase {
  return {
    recordId: row.recordId,
    revisionId: row.revisionId,
    golden: { key: keyOf(row.recordId), question: row.question, language: row.language, context: row.context, expected: row.expected, mustNot: row.mustNot, tags: row.tags },
  }
}

/** A country's released golden cases: each record's head, by key. */
export async function releasedGoldenCases(countryId: string): Promise<StoredGoldenCase[]> {
  const rows = await withPlatformAccess(REASON, () =>
    getDb()
      .select({ body: knowledgeGoldenCaseRevisions })
      .from(knowledgeRecords)
      .innerJoin(knowledgeGoldenCaseRevisions, eq(knowledgeGoldenCaseRevisions.revisionId, knowledgeRecords.headRevisionId))
      .where(and(eq(knowledgeRecords.type, 'golden_case'), isNull(knowledgeRecords.organizationId), eq(knowledgeRecords.countryId, countryId), isNotNull(knowledgeRecords.headRevisionId)))
      .orderBy(asc(knowledgeRecords.id))
      .limit(MAX_RUN_CASES),
  )
  return rows.map((row) => toStored(row.body))
}

/**
 * The golden cases of one change request: the newest revision of each, by key.
 * `country` is the request's; `inPreview` whether it was published to preview.
 * Null when there is no such request.
 */
export async function changeRequestGoldenCases(changeRequestId: string): Promise<{ countryId: string; inPreview: boolean; cases: StoredGoldenCase[] } | null> {
  return withPlatformAccess(REASON, async () => {
    const db = getDb()
    const [request] = await db.select({ countryId: knowledgeChangeRequests.countryId }).from(knowledgeChangeRequests).where(eq(knowledgeChangeRequests.id, changeRequestId))
    if (!request) return null
    const [preview] = await db
      .select({ seq: knowledgeReleaseMoves.seq })
      .from(knowledgeReleaseMoves)
      .where(and(eq(knowledgeReleaseMoves.changeRequestId, changeRequestId), eq(knowledgeReleaseMoves.channel, 'preview')))
      .limit(1)
    const rows = await db
      .selectDistinctOn([knowledgeRevisions.recordId], { body: knowledgeGoldenCaseRevisions })
      .from(knowledgeRevisions)
      .innerJoin(knowledgeGoldenCaseRevisions, eq(knowledgeGoldenCaseRevisions.revisionId, knowledgeRevisions.revisionId))
      .where(eq(knowledgeRevisions.changeRequestId, changeRequestId))
      .orderBy(asc(knowledgeRevisions.recordId), sql`${knowledgeRevisions.createdAt} DESC`, sql`${knowledgeRevisions.revisionId} DESC`)
      .limit(MAX_RUN_CASES)
    return { countryId: request.countryId, inPreview: Boolean(preview), cases: rows.map((row) => toStored(row.body)) }
  })
}

/** The country's newest stable release, or null when nothing of it is released. */
export async function stableReleaseSeq(countryId: string): Promise<number | null> {
  const rows = await withPlatformAccess(REASON, () =>
    getDb().execute<{ seq: string | number | null }>(sql`
      SELECT max(m.seq) AS seq FROM knowledge_release_moves m JOIN knowledge_records r ON r.id = m.record_id
      WHERE m.channel = 'stable' AND r.organization_id IS NULL AND r.country_id = ${countryId}`),
  )
  const seq = rows[0]?.seq
  return seq === null || seq === undefined ? null : Number(seq)
}

/** Open a run with its cases, in the order given. */
export async function insertGoldenRun(input: {
  countryId: string
  changeRequestId: string | null
  askedIn: string
  startedBy: string
  releaseSeq: number | null
  cases: readonly StoredGoldenCase[]
}): Promise<string> {
  const id = randomUUID()
  await withPlatformAccess(REASON, () =>
    getDb().transaction(async (tx) => {
      await tx.insert(knowledgeGoldenRuns).values({ id, countryId: input.countryId, changeRequestId: input.changeRequestId, askedIn: input.askedIn, startedBy: input.startedBy, releaseSeq: input.releaseSeq })
      await tx.insert(knowledgeGoldenRunCases).values(input.cases.map((stored, position) => ({ runId: id, recordId: stored.recordId, revisionId: stored.revisionId, position })))
    }),
  )
  return id
}

export interface GoldenRunState {
  run: GoldenRunRow
  cases: (GoldenRunCaseRow & { golden: GoldenCase })[]
}

/** A run with every case and the case's body at the revision the run read. */
export async function findGoldenRun(runId: string): Promise<GoldenRunState | null> {
  return withPlatformAccess(REASON, async () => {
    const db = getDb()
    const [run] = await db.select().from(knowledgeGoldenRuns).where(eq(knowledgeGoldenRuns.id, runId))
    if (!run) return null
    const rows = await db
      .select({ entry: knowledgeGoldenRunCases, body: knowledgeGoldenCaseRevisions })
      .from(knowledgeGoldenRunCases)
      .innerJoin(knowledgeGoldenCaseRevisions, eq(knowledgeGoldenCaseRevisions.revisionId, knowledgeGoldenRunCases.revisionId))
      .where(eq(knowledgeGoldenRunCases.runId, runId))
      .orderBy(asc(knowledgeGoldenRunCases.position))
      .limit(MAX_RUN_CASES)
    return { run, cases: rows.map((row) => ({ ...row.entry, golden: toStored(row.body).golden })) }
  })
}

/**
 * Take a pending case for asking: it is given its conversation before the
 * question is sent, so the turn's context finds the case. False when another
 * call took it first.
 */
export async function claimCaseForAsking(runId: string, recordId: string, ask: { askId: string; conversationId: string }): Promise<boolean> {
  const taken = await withPlatformAccess(REASON, () =>
    getDb()
      .update(knowledgeGoldenRunCases)
      .set({ askId: ask.askId, conversationId: ask.conversationId, askedAt: new Date() })
      .where(and(eq(knowledgeGoldenRunCases.runId, runId), eq(knowledgeGoldenRunCases.recordId, recordId), isNull(knowledgeGoldenRunCases.askId)))
      .returning({ recordId: knowledgeGoldenRunCases.recordId }),
  )
  return taken.length > 0
}

/** Record what became of a case; a case already settled keeps its verdict. */
export async function settleCase(runId: string, recordId: string, outcome: { passed: boolean; result: GoldenCaseResult } | { failure: string }): Promise<void> {
  const values = 'failure' in outcome ? { failure: outcome.failure.slice(0, 500) } : { passed: outcome.passed, result: outcome.result }
  await withPlatformAccess(REASON, () =>
    getDb()
      .update(knowledgeGoldenRunCases)
      .set({ ...values, settledAt: new Date() })
      .where(and(eq(knowledgeGoldenRunCases.runId, runId), eq(knowledgeGoldenRunCases.recordId, recordId), isNull(knowledgeGoldenRunCases.settledAt))),
  )
}

export async function finishGoldenRun(runId: string): Promise<void> {
  await withPlatformAccess(REASON, () =>
    getDb()
      .update(knowledgeGoldenRuns)
      .set({ finishedAt: new Date() })
      .where(and(eq(knowledgeGoldenRuns.id, runId), isNull(knowledgeGoldenRuns.finishedAt))),
  )
}

/** The golden case a conversation's turn answers, with the organization its run asked in; null for any other conversation. */
export async function goldenCaseOfConversation(conversationId: string): Promise<{ askedIn: string; golden: GoldenCase } | null> {
  const [row] = await withPlatformAccess(REASON, () =>
    getDb()
      .select({ askedIn: knowledgeGoldenRuns.askedIn, body: knowledgeGoldenCaseRevisions })
      .from(knowledgeGoldenRunCases)
      .innerJoin(knowledgeGoldenRuns, eq(knowledgeGoldenRuns.id, knowledgeGoldenRunCases.runId))
      .innerJoin(knowledgeGoldenCaseRevisions, eq(knowledgeGoldenCaseRevisions.revisionId, knowledgeGoldenRunCases.revisionId))
      .where(eq(knowledgeGoldenRunCases.conversationId, conversationId))
      .limit(1),
  )
  return row ? { askedIn: row.askedIn, golden: toStored(row.body).golden } : null
}

/** What the conversations' turns cost, from the usage ledger of the organization they ran in, by conversation; absent where the ledger holds no row. */
export async function ledgerCostUsd(organizationId: string, conversationIds: readonly string[]): Promise<Map<string, number>> {
  if (conversationIds.length === 0) return new Map()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ conversationId: llmUsageEvents.conversationId, cost: sql<string>`sum(${llmUsageEvents.costUsd})` })
      .from(llmUsageEvents)
      .where(and(eq(llmUsageEvents.organizationId, organizationId), inArray(llmUsageEvents.conversationId, [...conversationIds])))
      .groupBy(llmUsageEvents.conversationId),
  )
  return new Map(rows.flatMap((row) => (row.conversationId ? [[row.conversationId, Number(row.cost)] as const] : [])))
}
