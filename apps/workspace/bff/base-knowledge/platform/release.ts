/**
 * Publish and rollback (ADR-0165, design §4.4): release moves, appended in one
 * transaction with the head moves they make. Insert-only; a rollback appends
 * the inverse moves, so every revision that was ever stable stays readable and
 * an old citation still resolves.
 *
 * - Preview: a move per record to the request's newest revision; no head moves.
 * - Stable: needs a preview first; moves each head, so entitled offices read it;
 *   refused with 409 when another request moved one of these records since this
 *   one was opened. Each published text gets an indexing run.
 * - Rollback: each record back to what it was before the stable publish;
 *   refused with 409 when a later release moved the head again.
 *
 * The database holds the same rules a second time (0205's triggers): a publish
 * only of an approved request's own revisions, a head only where the newest
 * stable move points.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import { sqlTextArray } from '@/lib/db/sql-list'
import { ConflictError } from '@/lib/api/errors'
import { knowledgeManifestationRevisions, knowledgeRecords } from '@/lib/db/schema/knowledge-records'
import { knowledgeIndexRuns, knowledgeReleaseMoves } from '@/lib/db/schema/knowledge-platform'
import type { ReleaseChannel } from '@/lib/base-knowledge/wire/vocab'
import type { Tx } from '../store/repository'
import { lockChangeRequest, newestPerRecord, platformTransaction, requestRevisions, setChangeRequestStatus } from './store'

export interface ReleaseActor {
  by: string
  decisionSource: 'app' | 'elicitation'
}

export interface PublishOutcome {
  channel: ReleaseChannel
  moved: number
  /** The indexing runs a stable publish opened, one per published text; the caller enqueues their jobs. */
  indexRuns: string[]
}

async function headsOf(tx: Tx, recordIds: readonly string[]): Promise<Map<string, string | null>> {
  const rows = await tx
    .select({ id: knowledgeRecords.id, head: knowledgeRecords.headRevisionId })
    .from(knowledgeRecords)
    .where(inArray(knowledgeRecords.id, [...recordIds]))
  return new Map(rows.map((row) => [row.id, row.head]))
}

async function newestPreview(tx: Tx, recordId: string): Promise<string | null> {
  const [move] = await tx
    .select({ to: knowledgeReleaseMoves.toRevisionId })
    .from(knowledgeReleaseMoves)
    .where(and(eq(knowledgeReleaseMoves.recordId, recordId), eq(knowledgeReleaseMoves.channel, 'preview')))
    .orderBy(desc(knowledgeReleaseMoves.seq))
    .limit(1)
  return move?.to ?? null
}

async function refuseMovedSince(tx: Tx, requestId: string, baseSeq: number, recordIds: readonly string[]): Promise<void> {
  const [moved] = await tx
    .select({ recordId: knowledgeReleaseMoves.recordId })
    .from(knowledgeReleaseMoves)
    .where(
      and(
        inArray(knowledgeReleaseMoves.recordId, [...recordIds]),
        eq(knowledgeReleaseMoves.channel, 'stable'),
        gt(knowledgeReleaseMoves.seq, baseSeq),
        ne(knowledgeReleaseMoves.changeRequestId, requestId),
      ),
    )
    .limit(1)
  if (moved) {
    throw new ConflictError(
      `${moved.recordId} was released by another change request after this one was opened; open a new request on the current state.`,
    )
  }
}

async function hasPreview(tx: Tx, requestId: string): Promise<boolean> {
  const [move] = await tx
    .select({ seq: knowledgeReleaseMoves.seq })
    .from(knowledgeReleaseMoves)
    .where(and(eq(knowledgeReleaseMoves.changeRequestId, requestId), eq(knowledgeReleaseMoves.channel, 'preview')))
    .limit(1)
  return Boolean(move)
}

async function openIndexRuns(tx: Tx, requestId: string, revisionIds: readonly string[]): Promise<string[]> {
  if (revisionIds.length === 0) return []
  const texts = await tx
    .select({ revisionId: knowledgeManifestationRevisions.revisionId, corpusFile: knowledgeManifestationRevisions.corpusFile })
    .from(knowledgeManifestationRevisions)
    .where(inArray(knowledgeManifestationRevisions.revisionId, [...revisionIds]))
  const runs = texts.flatMap((text) =>
    text.corpusFile ? [{ id: randomUUID(), revisionId: text.revisionId, corpusFile: text.corpusFile, changeRequestId: requestId }] : [],
  )
  if (runs.length > 0) await tx.insert(knowledgeIndexRuns).values(runs)
  return runs.map((run) => run.id)
}

export async function publishChangeRequest(requestId: string, channel: ReleaseChannel, actor: ReleaseActor): Promise<PublishOutcome> {
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new ConflictError('No such change request.')
    if (request.status !== 'approved') {
      throw new ConflictError(`The change request is ${request.status}; only an approved one is published.`)
    }
    if (channel === 'stable' && !(await hasPreview(tx, requestId))) {
      throw new ConflictError('Publish to preview first, and check it there; then publish to stable.')
    }
    const revisions = newestPerRecord(await requestRevisions(tx, requestId))
    const recordIds = revisions.map((revision) => revision.recordId)
    if (channel === 'stable') await refuseMovedSince(tx, requestId, request.baseReleaseSeq, recordIds)
    const heads = await headsOf(tx, recordIds)
    for (const revision of revisions) {
      const from = channel === 'stable' ? (heads.get(revision.recordId) ?? null) : await newestPreview(tx, revision.recordId)
      await tx.insert(knowledgeReleaseMoves).values({
        recordId: revision.recordId,
        channel,
        action: 'publish',
        fromRevisionId: from,
        toRevisionId: revision.revisionId,
        changeRequestId: requestId,
        releasedBy: actor.by,
        decisionSource: actor.decisionSource,
      })
      if (channel === 'stable') {
        await tx.update(knowledgeRecords).set({ headRevisionId: revision.revisionId }).where(eq(knowledgeRecords.id, revision.recordId))
      }
    }
    if (channel === 'preview') return { channel, moved: revisions.length, indexRuns: [] }
    await setChangeRequestStatus(tx, requestId, 'published', 'publishedAt')
    const indexRuns = await openIndexRuns(
      tx,
      requestId,
      revisions.filter((revision) => revision.type === 'manifestation').map((revision) => revision.revisionId),
    )
    return { channel, moved: revisions.length, indexRuns }
  })
}

export interface RollbackOutcome {
  restored: number
  /** Base-corpus files the rolled-back request released and no released copy names any more: de-indexed after the commit (ADR-0173). */
  unreleasedFiles: string[]
}

/** Undo a published request: each record back to its head before it, as appended inverse moves. */
export async function rollbackChangeRequest(requestId: string, reason: string, actor: ReleaseActor): Promise<RollbackOutcome> {
  return platformTransaction(async (tx) => {
    const request = await lockChangeRequest(tx, requestId)
    if (!request) throw new ConflictError('No such change request.')
    if (request.status !== 'published') {
      throw new ConflictError(`The change request is ${request.status}; only a published one is rolled back.`)
    }
    const published = await tx
      .select()
      .from(knowledgeReleaseMoves)
      .where(
        and(
          eq(knowledgeReleaseMoves.changeRequestId, requestId),
          eq(knowledgeReleaseMoves.channel, 'stable'),
          eq(knowledgeReleaseMoves.action, 'publish'),
        ),
      )
    const heads = await headsOf(
      tx,
      published.map((move) => move.recordId),
    )
    for (const move of published) {
      if (heads.get(move.recordId) !== move.toRevisionId) {
        throw new ConflictError(`${move.recordId} was released again after this request; roll that release back first.`)
      }
    }
    for (const move of published) {
      for (const channel of ['stable', 'preview'] as const) {
        await tx.insert(knowledgeReleaseMoves).values({
          recordId: move.recordId,
          channel,
          action: 'rollback',
          fromRevisionId: move.toRevisionId,
          toRevisionId: move.fromRevisionId,
          changeRequestId: requestId,
          releasedBy: actor.by,
          decisionSource: actor.decisionSource,
          reason,
        })
      }
      await tx.update(knowledgeRecords).set({ headRevisionId: move.fromRevisionId }).where(eq(knowledgeRecords.id, move.recordId))
    }
    await setChangeRequestStatus(tx, requestId, 'rolled_back', 'decidedAt')
    const released = published.flatMap((move) => (move.toRevisionId ? [move.toRevisionId] : []))
    const unreleased =
      released.length === 0
        ? []
        : await tx.execute<{ corpus_file: string }>(sql`
            SELECT DISTINCT m.corpus_file FROM knowledge_manifestation_revisions m
            WHERE m.revision_id::text = ANY(${sqlTextArray(released)}) AND m.corpus_file IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM knowledge_records r JOIN knowledge_manifestation_revisions h ON h.revision_id = r.head_revision_id
                WHERE r.organization_id IS NULL AND h.corpus_file = m.corpus_file)`)
    return { restored: published.length, unreleasedFiles: unreleased.map((row) => row.corpus_file) }
  })
}
