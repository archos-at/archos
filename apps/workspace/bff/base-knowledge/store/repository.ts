/**
 * The SQL of the base knowledge records (migration 0202, ADR-0163), owner-neutral:
 * a record, its append-only revisions with a typed body each, its head, and the
 * checks against it. No authorization here; the office service checks before it
 * calls, and every statement runs under its organization (`withTenant`), so the
 * layered RLS and the restrictive write guards hold as a backstop.
 *
 * The platform layer (design §4.4) writes the same tables with
 * `organizationId: null` under the platform role; nothing in this file assumes
 * an office except where a function says so.
 */

import 'server-only'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { isUniqueViolation } from '@/lib/db/errors'
import { ConflictError } from '@/lib/api/errors'
import {
  knowledgeChecks,
  knowledgeEditionRevisions,
  knowledgeManifestationRevisions,
  knowledgeRecords,
  knowledgeRevisions,
  knowledgeRulesetRevisions,
  knowledgeWorkRevisions,
  type KnowledgeCheckResult,
  type KnowledgeProvenance,
  type KnowledgeTerms,
  type LicenceClass,
  type KnowledgeRecordType,
} from '@/lib/db/schema/knowledge-records'
import {
  knowledgeAuthorityRevisions,
  knowledgeRelationRevisions,
  knowledgeTerritoryRevisions,
} from '@/lib/db/schema/knowledge-platform'
import { knowledgeSourceRevisions } from '@/lib/db/schema/knowledge-sources'
import { knowledgeGoldenCaseRevisions } from '@/lib/db/schema/knowledge-golden'
import type { EntryCheck, EntryValues } from '../wire'
import { OFFICE_WORK_KINDS, type OfficeWorkKind } from '@/lib/base-knowledge/wire/vocab'

const isOfficeWorkKind = (kind: string): kind is OfficeWorkKind => (OFFICE_WORK_KINDS as readonly string[]).includes(kind)

/** Most entries one office lists or a turn reads. */
export const MAX_OFFICE_ENTRIES = 500

export type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

/** The three records one held copy is: its work, its edition, the copy itself. */
export interface EntryRecordIds {
  workId: string
  editionId: string
  copyId: string
}

export interface StoredEntry extends EntryRecordIds {
  documentId: string
  /**
   * Whether the work belongs to no document: it does once a second edition
   * joined it (`office-editions.ts`), so removing one edition's document never
   * takes the work, and with it the other editions, along.
   */
  workStandsAlone: boolean
  /** The work's head is set: a person confirmed the values in force. */
  confirmed: boolean
  values: EntryValues
  provenance: KnowledgeProvenance
  /** The copy's licence statements, who made them and when. */
  terms: KnowledgeTerms
  lastCheck: EntryCheck | null
  createdAt: Date
}

export const newRecordId = (type: KnowledgeRecordType) => `${type}_${randomUUID()}`

/** Each record type's body table (0202, 0204, 0205, 0211, 0212, 0228): the one list every reader of revision bodies walks. */
export const BODY_TABLES = {
  work: knowledgeWorkRevisions,
  edition: knowledgeEditionRevisions,
  manifestation: knowledgeManifestationRevisions,
  ruleset: knowledgeRulesetRevisions,
  territory: knowledgeTerritoryRevisions,
  authority: knowledgeAuthorityRevisions,
  relation: knowledgeRelationRevisions,
  source: knowledgeSourceRevisions,
  golden_case: knowledgeGoldenCaseRevisions,
} as const

/**
 * One revision of a record, with its typed body; returns the revision id.
 * Owner-neutral: the office passes its organization, the platform `null` and
 * the change request the revision is proposed in (0205 requires it).
 */
export async function appendRevision(
  tx: Tx,
  input: {
    organizationId: string | null
    recordId: string
    type: KnowledgeRecordType
    createdBy: string
    provenance: KnowledgeProvenance
    changeRequestId?: string
  },
  body: Record<string, unknown>
): Promise<string> {
  const revisionId = randomUUID()
  const base = { revisionId, recordId: input.recordId, organizationId: input.organizationId }
  await tx.insert(knowledgeRevisions).values({
    revisionId,
    recordId: input.recordId,
    recordType: input.type,
    organizationId: input.organizationId,
    createdBy: input.createdBy,
    provenance: input.provenance,
    changeRequestId: input.changeRequestId ?? null,
  })
  // The body's columns are the caller's typed values; each table's own CHECKs hold them.
  await tx.insert(BODY_TABLES[input.type]).values({ ...base, ...body } as typeof knowledgeWorkRevisions.$inferInsert)
  return revisionId
}

type WorkBody = Omit<typeof knowledgeWorkRevisions.$inferInsert, 'revisionId' | 'recordId' | 'organizationId'>
type EditionBody = Omit<typeof knowledgeEditionRevisions.$inferInsert, 'revisionId' | 'recordId' | 'organizationId'>
type CopyBody = Omit<typeof knowledgeManifestationRevisions.$inferInsert, 'revisionId' | 'recordId' | 'organizationId'>
export type RulesetBody = Omit<typeof knowledgeRulesetRevisions.$inferInsert, 'revisionId' | 'recordId' | 'organizationId'>

export function bodiesOf(
  values: EntryValues,
  ids: EntryRecordIds,
  terms: KnowledgeTerms
): { work: WorkBody; edition: EditionBody; copy: CopyBody } {
  return {
    work: {
      kind: values.kind,
      title: values.title,
      identifiers: values.designation ? { designation: values.designation } : {},
      territoryIds: values.territoryIds,
      issuer: values.issuer,
      addressees: values.addressees,
    },
    edition: { workId: ids.workId, label: values.editionLabel, issuedOn: values.issuedOn, inForceFrom: values.inForceFrom, inForceTo: values.inForceTo },
    copy: { editionId: ids.editionId, licenceClass: values.licenceClass, terms },
  }
}

export interface WriteContext {
  organizationId: string
  createdBy: string
  provenance: KnowledgeProvenance
  /** What the office's licence allows, as the copy's revision records it. */
  terms: KnowledgeTerms
}

/** Append one revision to each of the three records; returns the revision ids. */
async function appendEntryRevisions(tx: Tx, ids: EntryRecordIds, values: EntryValues, context: WriteContext) {
  const bodies = bodiesOf(values, ids, context.terms)
  const common = { organizationId: context.organizationId, createdBy: context.createdBy, provenance: context.provenance }
  return {
    work: await appendRevision(tx, { ...common, recordId: ids.workId, type: 'work' }, bodies.work),
    edition: await appendRevision(tx, { ...common, recordId: ids.editionId, type: 'edition' }, bodies.edition),
    copy: await appendRevision(tx, { ...common, recordId: ids.copyId, type: 'manifestation' }, bodies.copy),
  }
}

async function moveHeads(tx: Tx, ids: EntryRecordIds, revisions: { work: string; edition: string; copy: string }) {
  for (const [recordId, revisionId] of [
    [ids.workId, revisions.work],
    [ids.editionId, revisions.edition],
    [ids.copyId, revisions.copy],
  ] as const) {
    await tx.update(knowledgeRecords).set({ headRevisionId: revisionId }).where(eq(knowledgeRecords.id, recordId))
  }
}

/**
 * An office's proposal for one Archiv document: three records named after it,
 * each with one revision and no head. Nothing reaches an answer until a person
 * confirms ({@link confirmEntry}).
 */
export async function insertProposedEntry(
  documentId: string,
  values: EntryValues,
  context: WriteContext
): Promise<EntryRecordIds> {
  const ids: EntryRecordIds = {
    workId: newRecordId('work'),
    editionId: newRecordId('edition'),
    copyId: newRecordId('manifestation'),
  }
  await withTenant({ organizationId: context.organizationId }, () =>
    getDb().transaction(async (tx) => {
      const header = { organizationId: context.organizationId, documentId, createdBy: context.createdBy }
      // `knowledge_records_document_type_key` keeps one entry per document; a
      // proposal that loses the race to another is refused as a conflict below.
      await tx.insert(knowledgeRecords).values([
        { ...header, id: ids.workId, type: 'work' },
        { ...header, id: ids.editionId, type: 'edition' },
        { ...header, id: ids.copyId, type: 'manifestation' },
      ])
      await appendEntryRevisions(tx, ids, values, context)
    })
  ).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw new ConflictError('This document is already recorded as base knowledge; edit that entry instead.')
    throw error
  })
  return ids
}

/**
 * The values a person confirmed or edited, as one new revision per record with
 * every head moved to it, and, on a confirmation, the first check: confirming
 * an edition is checking it. One transaction.
 */
export async function writeConfirmedValues(
  ids: EntryRecordIds,
  values: EntryValues,
  context: WriteContext & { firstCheck?: boolean }
): Promise<void> {
  await withTenant({ organizationId: context.organizationId }, () =>
    getDb().transaction(async (tx) => {
      const revisions = await appendEntryRevisions(tx, ids, values, context)
      await moveHeads(tx, ids, revisions)
      if (context.firstCheck) {
        await tx.insert(knowledgeChecks).values({
          id: randomUUID(),
          organizationId: context.organizationId,
          targetId: ids.copyId,
          targetType: 'manifestation',
          checkedBy: context.createdBy,
          result: 'current',
          note: 'Bei der Bestätigung geprüft',
        })
      }
    })
  )
}

/** That somebody checked an office copy, and what they found. */
export async function insertCopyCheck(
  organizationId: string,
  copyId: string,
  check: { checkedBy: string; result: KnowledgeCheckResult; note: string | null }
): Promise<void> {
  await withTenant({ organizationId }, () =>
    getDb()
      .insert(knowledgeChecks)
      .values({ id: randomUUID(), organizationId, targetId: copyId, targetType: 'manifestation', ...check })
  )
}

interface RecordRow {
  id: string
  type: KnowledgeRecordType
  documentId: string | null
  headRevisionId: string | null
  createdAt: Date
}

/** The revision in force of each record: its head, or its newest revision while it has none. */
async function revisionInForce(tx: Tx, records: readonly RecordRow[]): Promise<Map<string, string>> {
  const result = new Map<string, string>()
  const headless = records.filter((record) => !record.headRevisionId).map((record) => record.id)
  for (const record of records) if (record.headRevisionId) result.set(record.id, record.headRevisionId)
  if (headless.length === 0) return result
  const latest = await tx
    .selectDistinctOn([knowledgeRevisions.recordId], {
      recordId: knowledgeRevisions.recordId,
      revisionId: knowledgeRevisions.revisionId,
    })
    .from(knowledgeRevisions)
    .where(inArray(knowledgeRevisions.recordId, headless))
    .orderBy(knowledgeRevisions.recordId, desc(knowledgeRevisions.createdAt))
  for (const row of latest) result.set(row.recordId, row.revisionId)
  return result
}

async function latestChecks(tx: Tx, copyIds: readonly string[]): Promise<Map<string, EntryCheck>> {
  if (copyIds.length === 0) return new Map()
  const rows = await tx
    .selectDistinctOn([knowledgeChecks.targetId])
    .from(knowledgeChecks)
    .where(inArray(knowledgeChecks.targetId, [...copyIds]))
    .orderBy(knowledgeChecks.targetId, desc(knowledgeChecks.checkedAt))
  return new Map(
    rows.map((row) => [
      row.targetId,
      { checkedAt: new Date(row.checkedAt).toISOString(), checkedBy: row.checkedBy, result: row.result, note: row.note },
    ])
  )
}

async function readBodies(tx: Tx, revisionIds: readonly string[]) {
  const ids = [...revisionIds]
  if (ids.length === 0) return { works: [], editions: [], copies: [], provenance: new Map<string, KnowledgeProvenance>() }
  const [works, editions, copies, revisions] = await Promise.all([
    tx.select().from(knowledgeWorkRevisions).where(inArray(knowledgeWorkRevisions.revisionId, ids)),
    tx.select().from(knowledgeEditionRevisions).where(inArray(knowledgeEditionRevisions.revisionId, ids)),
    tx.select().from(knowledgeManifestationRevisions).where(inArray(knowledgeManifestationRevisions.revisionId, ids)),
    tx
      .select({ revisionId: knowledgeRevisions.revisionId, provenance: knowledgeRevisions.provenance })
      .from(knowledgeRevisions)
      .where(inArray(knowledgeRevisions.revisionId, ids)),
  ])
  return { works, editions, copies, provenance: new Map(revisions.map((row) => [row.revisionId, row.provenance])) }
}

function groupByDocument(records: readonly RecordRow[]): Map<string, Partial<Record<KnowledgeRecordType, RecordRow>>> {
  const groups = new Map<string, Partial<Record<KnowledgeRecordType, RecordRow>>>()
  for (const record of records) {
    if (!record.documentId) continue
    const group = groups.get(record.documentId) ?? {}
    group[record.type] = record
    groups.set(record.documentId, group)
  }
  return groups
}

/**
 * An office's entries, newest first, each with the values in force and its
 * last check. `documentIds` narrows to those documents; the caller has already
 * decided which documents its reader may see.
 */
export async function readOfficeEntries(organizationId: string, documentIds?: readonly string[]): Promise<StoredEntry[]> {
  if (documentIds && documentIds.length === 0) return []
  return withTenant({ organizationId }, () =>
    getDb().transaction(async (tx) => {
      const records: RecordRow[] = await tx
        .select({
          id: knowledgeRecords.id,
          type: knowledgeRecords.type,
          documentId: knowledgeRecords.documentId,
          headRevisionId: knowledgeRecords.headRevisionId,
          createdAt: knowledgeRecords.createdAt,
        })
        .from(knowledgeRecords)
        .where(
          and(
            eq(knowledgeRecords.organizationId, organizationId),
            // An entry's records, and the works that stand alone: those two editions or more share.
            documentIds
              ? inArray(knowledgeRecords.documentId, [...documentIds])
              : or(isNotNull(knowledgeRecords.documentId), eq(knowledgeRecords.type, 'work'))
          )
        )
        .orderBy(desc(knowledgeRecords.createdAt))
        .limit(MAX_OFFICE_ENTRIES * 3)
      const inForce = await revisionInForce(tx, records)
      const bodies = await readBodies(tx, [...inForce.values()])
      const groups = groupByDocument(records)
      const sharedWorks = documentIds ? await standaloneWorksOf(tx, organizationId, bodies.editions, records) : []
      const allRecords = [...records, ...sharedWorks.map((work) => work.record)]
      if (sharedWorks.length > 0) {
        const more = await readBodies(tx, sharedWorks.flatMap((work) => (work.revisionId ? [work.revisionId] : [])))
        bodies.works.push(...more.works)
        for (const [id, provenance] of more.provenance) bodies.provenance.set(id, provenance)
        for (const work of sharedWorks) if (work.revisionId) inForce.set(work.record.id, work.revisionId)
      }
      const copyIds = [...groups.values()].flatMap((group) => (group.manifestation ? [group.manifestation.id] : []))
      const checks = await latestChecks(tx, copyIds)
      const works = new Map(allRecords.filter((record) => record.type === 'work').map((record) => [record.id, record]))
      return assembleEntries(groups, works, inForce, bodies, checks)
    })
  )
}

function assembleEntries(
  groups: Map<string, Partial<Record<KnowledgeRecordType, RecordRow>>>,
  works: ReadonlyMap<string, RecordRow>,
  inForce: Map<string, string>,
  bodies: Awaited<ReturnType<typeof readBodies>>,
  checks: Map<string, EntryCheck>
): StoredEntry[] {
  const entries: StoredEntry[] = []
  for (const [documentId, group] of groups) {
    const { edition, manifestation } = group
    if (!edition || !manifestation) continue
    const editionBody = bodies.editions.find((row) => row.revisionId === inForce.get(edition.id))
    // The work its edition names: once a second edition joined, a standalone one, while the document's own
    // first work still exists beside it with the edition's earlier revisions (`office-editions.ts`).
    const work = (editionBody ? works.get(editionBody.workId) : undefined) ?? group.work
    if (!work) continue
    const workBody = bodies.works.find((row) => row.revisionId === inForce.get(work.id))
    const copyBody = bodies.copies.find((row) => row.revisionId === inForce.get(manifestation.id))
    if (!workBody || !editionBody || !copyBody) continue
    // An office holds only its five kinds; a row of another kind is no entry of the office's.
    if (!isOfficeWorkKind(workBody.kind)) continue
    entries.push({
      workId: work.id,
      editionId: edition.id,
      copyId: manifestation.id,
      documentId,
      workStandsAlone: work.documentId === null,
      // The edition's own head: a second edition is a proposal while its work is long confirmed.
      confirmed: edition.headRevisionId !== null,
      values: {
        kind: workBody.kind,
        title: workBody.title,
        designation: workBody.identifiers.designation ?? null,
        editionLabel: editionBody.label,
        issuedOn: editionBody.issuedOn,
        inForceFrom: editionBody.inForceFrom,
        inForceTo: editionBody.inForceTo,
        territoryIds: workBody.territoryIds,
        issuer: workBody.issuer,
        addressees: workBody.addressees,
        licenceClass: copyBody.licenceClass,
      },
      provenance: bodies.provenance.get(editionBody.revisionId) ?? bodies.provenance.get(workBody.revisionId) ?? {},
      terms: copyBody.terms,
      lastCheck: checks.get(manifestation.id) ?? null,
      createdAt: new Date(edition.createdAt),
    })
  }
  return entries.slice(0, MAX_OFFICE_ENTRIES)
}

/**
 * The standalone works the editions of a narrowed read name: a read by
 * document id loads only those documents' records, and a shared work has none.
 */
async function standaloneWorksOf(
  tx: Tx,
  organizationId: string,
  editions: readonly { workId: string }[],
  loaded: readonly RecordRow[],
): Promise<{ record: RecordRow; revisionId: string | null }[]> {
  const have = new Set(loaded.map((record) => record.id))
  const wanted = [...new Set(editions.map((edition) => edition.workId))].filter((id) => !have.has(id))
  if (wanted.length === 0) return []
  const rows: RecordRow[] = await tx
    .select({
      id: knowledgeRecords.id,
      type: knowledgeRecords.type,
      documentId: knowledgeRecords.documentId,
      headRevisionId: knowledgeRecords.headRevisionId,
      createdAt: knowledgeRecords.createdAt,
    })
    .from(knowledgeRecords)
    .where(and(eq(knowledgeRecords.organizationId, organizationId), inArray(knowledgeRecords.id, wanted)))
  const inForce = await revisionInForce(tx, rows)
  return rows.map((record) => ({ record, revisionId: inForce.get(record.id) ?? null }))
}

/** Whether a document already has base-knowledge records (one entry per document). */
export async function documentHasEntry(organizationId: string, documentId: string): Promise<boolean> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ one: sql<number>`1` })
      .from(knowledgeRecords)
      .where(and(eq(knowledgeRecords.organizationId, organizationId), eq(knowledgeRecords.documentId, documentId)))
      .limit(1)
  )
  return rows.length > 0
}

/** Which of `documentIds` are base-knowledge copies: one query for a batch, so the search projection pays one read. */
export async function documentsWithEntries(organizationId: string, documentIds: readonly string[]): Promise<string[]> {
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .selectDistinct({ documentId: knowledgeRecords.documentId })
      .from(knowledgeRecords)
      .where(and(eq(knowledgeRecords.organizationId, organizationId), inArray(knowledgeRecords.documentId, [...documentIds])))
  )
  return rows.flatMap((row) => (row.documentId ? [row.documentId] : []))
}

/**
 * The entry (its work's id) each of `documentIds` is recorded as: one query for
 * a listing page, so the Büroablage can mark its standards (ADR-0163).
 */
export async function entryIdsForDocuments(organizationId: string, documentIds: readonly string[]): Promise<Map<string, string>> {
  if (documentIds.length === 0) return new Map()
  const rows = await withTenant({ organizationId }, () =>
    getDb()
      .select({ id: knowledgeRecords.id, documentId: knowledgeRecords.documentId })
      .from(knowledgeRecords)
      .where(
        and(
          eq(knowledgeRecords.organizationId, organizationId),
          eq(knowledgeRecords.type, 'work'),
          inArray(knowledgeRecords.documentId, [...documentIds])
        )
      )
  )
  return new Map(rows.flatMap((row) => (row.documentId ? [[row.documentId, row.id] as const] : [])))
}

/** The copy a document is, as its newest revision states it (a confirmed head, or a proposal). */
export interface DocumentCopy {
  licenceClass: LicenceClass
  editionId: string
  terms: KnowledgeTerms
  confirmed: boolean
}

/**
 * The copy a document is, or null when it is no base knowledge: what the ingest
 * dispatch asks before it indexes the document (a licensed copy without the AI
 * statement is not indexed) and what it stamps on the points it writes. The
 * newest revision is the head once confirmed, since every write moves the head.
 */
export async function copyForDocument(organizationId: string, documentId: string): Promise<DocumentCopy | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select({
        licenceClass: knowledgeManifestationRevisions.licenceClass,
        editionId: knowledgeManifestationRevisions.editionId,
        terms: knowledgeManifestationRevisions.terms,
        head: knowledgeRecords.headRevisionId,
      })
      .from(knowledgeRecords)
      .innerJoin(knowledgeManifestationRevisions, eq(knowledgeManifestationRevisions.recordId, knowledgeRecords.id))
      .innerJoin(knowledgeRevisions, eq(knowledgeRevisions.revisionId, knowledgeManifestationRevisions.revisionId))
      .where(
        and(
          eq(knowledgeRecords.organizationId, organizationId),
          eq(knowledgeRecords.documentId, documentId),
          eq(knowledgeRecords.type, 'manifestation')
        )
      )
      .orderBy(desc(knowledgeRevisions.createdAt))
      .limit(1)
  )
  if (!row) return null
  return { licenceClass: row.licenceClass, editionId: row.editionId, terms: row.terms, confirmed: row.head !== null }
}
