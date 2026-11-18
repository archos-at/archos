import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { ConflictError } from '@/lib/api/errors'
import {
  knowledgeEditionRevisions,
  knowledgeRecords,
  knowledgeRevisions,
  type KnowledgeProvenance,
  type KnowledgeTextProvenance,
} from '@/lib/db/schema/knowledge-records'
import {
  type CarriedFrom,
  knowledgeApprovals,
  knowledgeChangeRequests,
  knowledgeReleaseMoves,
  knowledgeReviewDecisions,
  knowledgeSecondReviews,
} from '@/lib/db/schema/knowledge-platform'
import type {
  ApprovalRole,
  ChangeRequestOrigin,
  ChangeRequestStatus,
  KnowledgeRecordType,
  ReviewDecision,
  ReleaseDecisionSource,
  ReviewDecisionSource,
  SecondReviewDecision,
  SecondReviewState,
} from '@/lib/base-knowledge/wire/vocab'
import { appendRevision, BODY_TABLES, type Tx } from '../store/repository'
import { captureViews } from './captures'
import { attachedTexts } from './text-store'
import { bodyOf, claimsOf, proposalKey, recordIdOf } from './records'
import { singleOperator } from './single-operator'
import { releaseWarnings, type DatedPlatformEdition, type KnownRecord } from './validate'
import type { ChangeRequestSummary, ChangeRequestView, ProposedRecord, RevisionView, SecondReviewRoleView } from './wire'

const REASON = 'platform base knowledge: change requests'

export const MAX_CHANGE_REQUESTS = 200

export function platformTransaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!singleOperator()) return withPlatformAccess(REASON, () => getDb().transaction(fn))
  return withPlatformAccess(REASON, () =>
    getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('knowledge.single_operator', 'on', true)`)
      return fn(tx)
    }),
  )
}

export type ChangeRequestRow = typeof knowledgeChangeRequests.$inferSelect

type NewChangeRequest = { title: string; countryId: string; createdBy: string; carriedFrom?: CarriedFrom }

export async function insertChangeRequest(input: NewChangeRequest): Promise<string> {
  return platformTransaction((tx) => insertChangeRequestIn(tx, input))
}

export async function insertChangeRequestIn(tx: Tx, input: NewChangeRequest): Promise<string> {
  const id = randomUUID()
  const [newest] = await tx.select({ seq: sql<string | null>`max(${knowledgeReleaseMoves.seq})` }).from(knowledgeReleaseMoves)
  await tx.insert(knowledgeChangeRequests).values({ id, ...input, baseReleaseSeq: Number(newest?.seq ?? 0) })
  return id
}

export async function lockChangeRequest(tx: Tx, id: string): Promise<ChangeRequestRow | null> {
  const [row] = await tx.select().from(knowledgeChangeRequests).where(eq(knowledgeChangeRequests.id, id)).for('update')
  return row ?? null
}

export async function findChangeRequest(id: string): Promise<ChangeRequestRow | null> {
  const [row] = await withPlatformAccess(REASON, () =>
    getDb().select().from(knowledgeChangeRequests).where(eq(knowledgeChangeRequests.id, id)),
  )
  return row ?? null
}

export async function setChangeRequestStatus(
  tx: Tx,
  id: string,
  status: ChangeRequestStatus,
  stamp: 'submittedAt' | 'decidedAt' | 'publishedAt' | null,
): Promise<void> {
  await tx
    .update(knowledgeChangeRequests)
    .set({ status, ...(stamp ? { [stamp]: new Date() } : {}) })
    .where(eq(knowledgeChangeRequests.id, id))
}

export async function listChangeRequests(
  filter: { status?: ChangeRequestStatus; countryId?: string; origin?: ChangeRequestOrigin; secondReview?: SecondReviewState },
  page: { offset: number; limit: number } = { offset: 0, limit: MAX_CHANGE_REQUESTS },
): Promise<ChangeRequestSummary[]> {
  const rows = await withPlatformAccess(REASON, () =>
    getDb()
      .select({
        request: knowledgeChangeRequests,
        revisionCount: sql<string>`(SELECT count(*) FROM knowledge_revisions r WHERE r.change_request_id = ${knowledgeChangeRequests.id})`,
      })
      .from(knowledgeChangeRequests)
      .where(
        and(
          filter.status ? eq(knowledgeChangeRequests.status, filter.status) : undefined,
          filter.countryId ? eq(knowledgeChangeRequests.countryId, filter.countryId) : undefined,
          filter.origin ? eq(knowledgeChangeRequests.origin, filter.origin) : undefined,
          filter.secondReview ? eq(knowledgeChangeRequests.secondReview, filter.secondReview) : undefined,
        ),
      )
      .orderBy(desc(knowledgeChangeRequests.createdAt), desc(knowledgeChangeRequests.id))
      .offset(page.offset)
      .limit(Math.min(page.limit, MAX_CHANGE_REQUESTS)),
  )
  return rows.map(({ request, revisionCount }) => ({ ...summaryOf(request), revisionCount: Number(revisionCount) }))
}

export function summaryOf(request: ChangeRequestRow): Omit<ChangeRequestSummary, 'revisionCount'> {
  return {
    id: request.id,
    title: request.title,
    countryId: request.countryId,
    status: request.status,
    createdBy: request.createdBy,
    createdAt: request.createdAt.toISOString(),
    origin: request.origin,
    sourceRecordId: request.sourceRecordId,
    monitorFinding: request.monitorFinding,
    approval: request.approval,
    secondReview: request.secondReview
      ? { state: request.secondReview, by: request.secondReviewBy, at: request.secondReviewAt?.toISOString() ?? null }
      : null,
  }
}

export async function knownPlatformRecords(tx: Tx, ids: readonly string[]): Promise<Map<string, KnownRecord>> {
  if (ids.length === 0) return new Map()
  const rows = await tx
    .select({ id: knowledgeRecords.id, type: knowledgeRecords.type, countryId: knowledgeRecords.countryId })
    .from(knowledgeRecords)
    .where(and(inArray(knowledgeRecords.id, [...ids]), isNull(knowledgeRecords.organizationId)))
  return new Map(rows.map((row) => [row.id, { type: row.type, countryId: row.countryId ?? '' }]))
}

export async function platformEditionsOf(tx: Tx, workIds: readonly string[]): Promise<DatedPlatformEdition[]> {
  if (workIds.length === 0) return []
  return tx
    .select({
      id: knowledgeRecords.id,
      workId: knowledgeEditionRevisions.workId,
      inForceFrom: knowledgeEditionRevisions.inForceFrom,
      inForceTo: knowledgeEditionRevisions.inForceTo,
    })
    .from(knowledgeRecords)
    .innerJoin(knowledgeEditionRevisions, eq(knowledgeEditionRevisions.revisionId, knowledgeRecords.headRevisionId))
    .where(
      and(
        isNull(knowledgeRecords.organizationId),
        eq(knowledgeRecords.type, 'edition'),
        inArray(knowledgeEditionRevisions.workId, [...workIds]),
      ),
    )
    .limit(2000)
}

export function idsOfBatch(records: readonly ProposedRecord[], named: (record: ProposedRecord) => string[]): string[] {
  return [...new Set(records.flatMap((record) => [recordIdOf(record), ...named(record)]))]
}

export interface ProposedRevision {
  key: string
  recordId: string
  revisionId: string
  status: 'written' | 'unchanged'
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  const entries = Object.entries(value as Record<string, unknown>).filter(([, member]) => member !== undefined)
  return `{${entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, member]) => `${JSON.stringify(name)}:${canonicalJson(member)}`).join(',')}}`
}

export async function insertProposedRecords(
  tx: Tx,
  request: ChangeRequestRow,
  records: readonly ProposedRecord[],
  context: {
    createdBy: string
    proposedBy: KnowledgeProvenance['proposedBy']
    viaClient?: string
    text?: KnowledgeTextProvenance
    pins?: ReadonlyMap<string, string>
    imported?: KnowledgeProvenance['imported']
  },
): Promise<ProposedRevision[]> {
  await tx
    .insert(knowledgeRecords)
    .values(
      records.map((record) => ({
        id: recordIdOf(record),
        organizationId: null,
        countryId: request.countryId,
        type: record.type,
        createdBy: context.createdBy,
      })),
    )
    .onConflictDoNothing({ target: knowledgeRecords.id })
  const newest = new Map(newestPerRecord(await requestRevisions(tx, request.id)).map((revision) => [revision.recordId, revision]))
  const written: ProposedRevision[] = []
  for (const record of records) {
    const recordId = recordIdOf(record)
    const current = newest.get(recordId)
    const had = current?.provenance.text
    const sameBytes =
      !context.text ||
      (had?.sha256 === context.text.sha256 &&
        had.origin === context.text.origin &&
        had.sourceOrigin === context.text.sourceOrigin &&
        had.sourceRevisionId === context.text.sourceRevisionId)
    if (current && sameBytes && canonicalJson(current.provenance.proposal) === canonicalJson(record)) {
      written.push({ key: proposalKey(record), recordId, revisionId: current.revisionId, status: 'unchanged' })
      continue
    }
    const kept = current?.provenance.text
    const text = context.text ?? (record.type === 'manifestation' && kept && kept.fileName === record.corpusFile ? kept : undefined)
    const pin = context.pins?.get(recordId)
    const imported = context.imported ? { ...context.imported, ...(pin ? { sha256: pin } : {}) } : current?.provenance.imported
    const revisionId = await appendRevision(
      tx,
      {
        organizationId: null,
        recordId,
        type: record.type,
        createdBy: context.createdBy,
        provenance: {
          proposedBy: context.proposedBy,
          citations: record.citations,
          proposal: record as unknown as Record<string, unknown>,
          ...(context.viaClient ? { viaClient: context.viaClient } : {}),
          ...(text ? { text } : {}),
          ...(imported ? { imported } : {}),
        },
        changeRequestId: request.id,
      },
      { ...bodyOf(record), ...(namedBytes(record, text, context.pins?.get(recordId)) ?? {}) },
    )
    written.push({ key: proposalKey(record), recordId, revisionId, status: 'written' })
  }
  return written
}

function namedBytes(record: ProposedRecord, text: KnowledgeTextProvenance | undefined, pin: string | undefined): { sha256: string } | null {
  if (record.type !== 'manifestation' || record.corpusFile === null) return null
  const sha256 = text?.fileName === record.corpusFile ? text.sha256 : pin
  return sha256 ? { sha256 } : null
}

async function bodiesOf(tx: Tx, revisionIds: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  const bodies = new Map<string, Record<string, unknown>>()
  if (revisionIds.length === 0) return bodies
  for (const table of Object.values(BODY_TABLES)) {
    const rows = (await tx.select().from(table).where(inArray(table.revisionId, [...revisionIds]))) as Record<string, unknown>[]
    for (const row of rows) bodies.set(String(row.revisionId), row)
  }
  return bodies
}

export interface RequestRevision {
  revisionId: string
  recordId: string
  type: KnowledgeRecordType
  createdBy: string
  createdAt: Date
  provenance: KnowledgeProvenance
}

export async function requestRevisions(tx: Tx, requestId: string): Promise<RequestRevision[]> {
  return tx
    .select({
      revisionId: knowledgeRevisions.revisionId,
      recordId: knowledgeRevisions.recordId,
      type: knowledgeRevisions.recordType,
      createdBy: knowledgeRevisions.createdBy,
      createdAt: knowledgeRevisions.createdAt,
      provenance: knowledgeRevisions.provenance,
    })
    .from(knowledgeRevisions)
    .where(eq(knowledgeRevisions.changeRequestId, requestId))
    .orderBy(knowledgeRevisions.createdAt, knowledgeRevisions.revisionId)
}

export function newestPerRecord(revisions: readonly RequestRevision[]): RequestRevision[] {
  const newest = new Map<string, RequestRevision>()
  for (const revision of revisions) newest.set(revision.recordId, revision)
  return [...newest.values()]
}

async function newestDecisions(tx: Tx, requestId: string): Promise<Map<string, ReviewDecision>> {
  const rows = await tx
    .select()
    .from(knowledgeReviewDecisions)
    .where(eq(knowledgeReviewDecisions.changeRequestId, requestId))
    .orderBy(knowledgeReviewDecisions.decidedAt)
  return new Map(rows.map((row) => [`${row.revisionId}|${row.claimPath}`, row.decision]))
}

export async function reviewedRevisions(tx: Tx, requestId: string): Promise<RevisionView[]> {
  const revisions = newestPerRecord(await requestRevisions(tx, requestId))
  const [bodies, decisions] = await Promise.all([
    bodiesOf(
      tx,
      revisions.map((revision) => revision.revisionId),
    ),
    newestDecisions(tx, requestId),
  ])
  return revisions.map((revision) => ({
    revisionId: revision.revisionId,
    recordId: revision.recordId,
    type: revision.type,
    createdBy: revision.createdBy,
    citations: revision.provenance.citations ?? [],
    claims: claimsOf(bodies.get(revision.revisionId) ?? {}).map((claim) => ({
      ...claim,
      decision: decisions.get(`${revision.revisionId}|${claim.path}`) ?? null,
    })),
  }))
}

export async function readChangeRequest(id: string): Promise<ChangeRequestView | null> {
  return platformTransaction(async (tx) => {
    const [request] = await tx.select().from(knowledgeChangeRequests).where(eq(knowledgeChangeRequests.id, id))
    if (!request) return null
    const [revisions, texts, approvals, releases, captures, secondReviewRolesOf, unchecked] = await Promise.all([
      reviewedRevisions(tx, id),
      attachedTexts(tx, id),
      tx.select().from(knowledgeApprovals).where(eq(knowledgeApprovals.changeRequestId, id)).orderBy(knowledgeApprovals.decidedAt),
      tx
        .select()
        .from(knowledgeReleaseMoves)
        .where(eq(knowledgeReleaseMoves.changeRequestId, id))
        .orderBy(knowledgeReleaseMoves.seq)
        .limit(2000),
      captureViews(tx, id),
      secondReviewRoles(tx, id),
      tx.execute<{ unchecked: boolean }>(sql`SELECT knowledge_sources_unchecked(${id}::uuid) AS unchecked`),
    ])
    return {
      ...summaryOf(request),
      submittedAt: request.submittedAt?.toISOString() ?? null,
      publishedAt: request.publishedAt?.toISOString() ?? null,
      revisions,
      texts,
      captures,
      sourcesUnchecked: unchecked[0]?.unchecked === true,
      warnings: releaseWarnings(request.countryId, revisions),
      secondReviewRoles: request.secondReview === null ? [] : secondReviewRolesOf,
      approvals: approvals.map((approval) => ({
        approver: approval.approver,
        role: approval.role,
        decisionSource: approval.decisionSource,
        decidedAt: approval.decidedAt.toISOString(),
        overrideReason: approval.overrideReason,
      })),
      releases: releases.map((move) => ({
        seq: move.seq,
        recordId: move.recordId,
        channel: move.channel,
        action: move.action,
        toRevisionId: move.toRevisionId,
        releasedAt: move.releasedAt.toISOString(),
        approval: request.approval,
      })),
    }
  })
}

export async function insertReviewDecisions(
  tx: Tx,
  requestId: string,
  reviewer: { by: string; decisionSource: ReviewDecisionSource },
  decisions: readonly { revisionId: string; claimPath: string; decision: ReviewDecision; note?: string; sourceChecked?: boolean }[],
): Promise<void> {
  try {
    await tx.insert(knowledgeReviewDecisions).values(
      decisions.map((decision) => ({
        id: randomUUID(),
        changeRequestId: requestId,
        revisionId: decision.revisionId,
        claimPath: decision.claimPath,
        decision: decision.decision,
        note: decision.note ?? null,
        sourceChecked: decision.sourceChecked ?? false,
        reviewer: reviewer.by,
        decisionSource: reviewer.decisionSource,
      })),
    )
  } catch (error) {
    if (/revision they wrote/.test(errorText(error))) {
      throw new ConflictError('You wrote a revision in this change request, so another person reviews its claims (four eyes).')
    }
    throw error
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? `${error.message} ${String((error as { cause?: unknown }).cause ?? '')}` : ''
}

export async function awaitedApprovalRoles(tx: Tx, requestId: string): Promise<ApprovalRole[]> {
  const rows = await tx.execute<{ role: string }>(sql`
    SELECT needed AS role FROM unnest(knowledge_required_approval_roles(${requestId}::uuid)) AS needed
    WHERE NOT EXISTS (SELECT 1 FROM knowledge_approvals a WHERE a.change_request_id = ${requestId}::uuid AND a.role = needed)
    ORDER BY needed`)
  return rows.map((row) => row.role as ApprovalRole)
}

const SOURCE_UNCHECKED_FOUR_EYES =
  'A record cites an operator-supplied capture, or a capture or a text nobody fetched from a reviewed source (uploaded, only named in the base corpus, or fetched through a source that is still in a draft or that one person released alone), and nobody but its author has checked it against its source. Another person checks it (sourceChecked on platform-knowledge-change-request-review); to approve alone, cite a fetched capture and attach the text with platform-knowledge-text-import, both through a built-in source or a released source another person approved.'

const SOURCE_UNCHECKED_SINGLE_OPERATOR =
  'A record cites an operator-supplied capture, or a capture or a text nobody fetched from a reviewed source, and nobody has checked it against its source. This deployment lets one operator work alone: check the source yourself, mark sourceChecked on your verdicts with platform-knowledge-change-request-review, then approve with an override.'

const sourceUnchecked = () => (singleOperator() ? SOURCE_UNCHECKED_SINGLE_OPERATOR : SOURCE_UNCHECKED_FOUR_EYES)

export async function insertApproval(
  tx: Tx,
  input: { changeRequestId: string; approver: string; role: ApprovalRole; decisionSource: ReleaseDecisionSource; overrideReason?: string },
): Promise<void> {
  try {
    await tx.insert(knowledgeApprovals).values({ id: randomUUID(), ...input })
  } catch (error) {
    const message = errorText(error)
    if (/revision they wrote/.test(message)) {
      throw new ConflictError('You wrote a revision in this change request, so another person approves it (four eyes).')
    }
    if (/override approval is for an author/.test(message)) {
      throw new ConflictError('You wrote no revision in this change request, so there is nothing to override; approve it without the override.')
    }
    if (/knowledge_approvals_once/.test(message)) throw new ConflictError('You already approved this change request in this role.')
    if (/no reviewer checked/.test(message)) throw new ConflictError(sourceUnchecked())
    throw error
  }
}

export async function requestAuthors(tx: Tx, requestId: string): Promise<Set<string>> {
  return new Set((await requestRevisions(tx, requestId)).map((revision) => revision.createdBy))
}

export async function secondReviewRoles(tx: Tx, requestId: string): Promise<SecondReviewRoleView[]> {
  const [alone, given] = await Promise.all([
    tx
      .selectDistinct({ role: knowledgeApprovals.role })
      .from(knowledgeApprovals)
      .where(and(eq(knowledgeApprovals.changeRequestId, requestId), isNotNull(knowledgeApprovals.overrideReason))),
    tx.select().from(knowledgeSecondReviews).where(eq(knowledgeSecondReviews.changeRequestId, requestId)),
  ])
  return alone
    .map(({ role }) => {
      const review = given.find((row) => row.role === role)
      return review
        ? { role, state: review.decision, by: review.reviewer, at: review.decidedAt.toISOString() }
        : { role, state: 'due' as const, by: null, at: null }
    })
    .sort((a, b) => a.role.localeCompare(b.role))
}

export async function insertSecondReview(
  tx: Tx,
  input: { changeRequestId: string; role: ApprovalRole; decision: SecondReviewDecision; reviewer: string; decisionSource: 'app' | 'elicitation' },
): Promise<void> {
  try {
    await tx.insert(knowledgeSecondReviews).values({ id: randomUUID(), ...input })
  } catch (error) {
    const message = errorText(error)
    if (/second reviewer may not have written/.test(message)) {
      throw new ConflictError('You wrote a revision in this change request, so another person gives its second review (four eyes).')
    }
    if (/knowledge_second_reviews_once/.test(message)) throw new ConflictError(`The second review in the ${input.role} role was given already.`)
    if (/owed only in a role approved alone/.test(message)) {
      throw new ConflictError(`No approval in the ${input.role} role was given alone, so no second review is owed in it.`)
    }
    if (/no reviewer checked/.test(message)) throw new ConflictError(sourceUnchecked())
    throw error
  }
}

export async function voidSecondReview(tx: Tx, requestId: string, by: string): Promise<void> {
  await tx
    .update(knowledgeChangeRequests)
    .set({ secondReview: 'void', secondReviewBy: by, secondReviewAt: new Date() })
    .where(eq(knowledgeChangeRequests.id, requestId))
}
