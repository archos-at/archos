import 'server-only'
import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { isUniqueViolation } from '@/lib/db/errors'
import { ConflictError } from '@/lib/api/errors'
import { knowledgeEditionRevisions, knowledgeRecords, knowledgeRevisions, knowledgeWorkRevisions, type KnowledgeIdentifiers } from '@/lib/db/schema/knowledge-records'
import type { EntryValues } from '../wire'
import { workDesignation } from '../office/work-designation'
import { appendRevision, bodiesOf, lockEditionWork, newRecordId, type EntryRecordIds, type StoredEntry, type Tx, type WriteContext } from './repository'

type WorkRow = typeof knowledgeWorkRevisions.$inferSelect
type EditionRow = typeof knowledgeEditionRevisions.$inferSelect

function bodyOf<Row extends { revisionId: string; recordId: string; organizationId: string | null }>(
  row: Row,
): Omit<Row, 'revisionId' | 'recordId' | 'organizationId'> {
  const { revisionId: _revision, recordId: _record, organizationId: _organization, ...body } = row
  return body
}

async function newestWork(tx: Tx, workId: string): Promise<WorkRow | null> {
  const [row] = await tx
    .select({ body: knowledgeWorkRevisions })
    .from(knowledgeWorkRevisions)
    .innerJoin(knowledgeRevisions, eq(knowledgeRevisions.revisionId, knowledgeWorkRevisions.revisionId))
    .where(eq(knowledgeWorkRevisions.recordId, workId))
    .orderBy(desc(knowledgeRevisions.createdAt))
    .limit(1)
  return row?.body ?? null
}

async function newestEdition(tx: Tx, editionId: string): Promise<EditionRow | null> {
  const [row] = await tx
    .select({ body: knowledgeEditionRevisions })
    .from(knowledgeEditionRevisions)
    .innerJoin(knowledgeRevisions, eq(knowledgeRevisions.revisionId, knowledgeEditionRevisions.revisionId))
    .where(eq(knowledgeEditionRevisions.recordId, editionId))
    .orderBy(desc(knowledgeRevisions.createdAt))
    .limit(1)
  return row?.body ?? null
}

function withWorkDesignation(identifiers: KnowledgeIdentifiers): KnowledgeIdentifiers {
  const designation = workDesignation(typeof identifiers.designation === 'string' ? identifiers.designation : null)
  const { designation: _dropped, ...rest } = identifiers
  return designation ? { ...rest, designation } : rest
}

async function standsAlone(tx: Tx, workId: string): Promise<boolean> {
  const [row] = await tx.select({ documentId: knowledgeRecords.documentId, type: knowledgeRecords.type }).from(knowledgeRecords).where(eq(knowledgeRecords.id, workId))
  return row?.type === 'work' && row.documentId === null
}

async function hasHead(tx: Tx, recordId: string): Promise<boolean> {
  const [row] = await tx.select({ head: knowledgeRecords.headRevisionId }).from(knowledgeRecords).where(eq(knowledgeRecords.id, recordId))
  return Boolean(row?.head)
}

async function moveHead(tx: Tx, recordId: string, revisionId: string): Promise<void> {
  await tx.update(knowledgeRecords).set({ headRevisionId: revisionId }).where(eq(knowledgeRecords.id, recordId))
}

async function standaloneWork(tx: Tx, earlier: StoredEntry, context: WriteContext): Promise<string> {
  if (earlier.workStandsAlone) return earlier.workId
  const current = await lockEditionWork(tx, earlier.editionId)
  if (current && current !== earlier.workId && (await standsAlone(tx, current))) return current
  const workId = newRecordId('work')
  const fallback = bodiesOf({ ...earlier.values, designation: workDesignation(earlier.values.designation) }, { workId, editionId: earlier.editionId, copyId: earlier.copyId }, earlier.terms)
  const work = await newestWork(tx, earlier.workId)
  const edition = await newestEdition(tx, earlier.editionId)
  const workBody = work ? { ...bodyOf(work), identifiers: withWorkDesignation(work.identifiers) } : fallback.work
  const editionBody = edition ? { ...bodyOf(edition), workId } : fallback.edition
  const common = { organizationId: context.organizationId, createdBy: context.createdBy, provenance: earlier.provenance }
  await tx.insert(knowledgeRecords).values({ id: workId, type: 'work', organizationId: context.organizationId, documentId: null, createdBy: context.createdBy })
  const workRevision = await appendRevision(tx, { ...common, recordId: workId, type: 'work' }, workBody)
  const editionRevision = await appendRevision(tx, { ...common, recordId: earlier.editionId, type: 'edition' }, editionBody)
  if (await hasHead(tx, earlier.editionId)) {
    await moveHead(tx, workId, workRevision)
    await moveHead(tx, earlier.editionId, editionRevision)
  }
  return workId
}

export async function insertEditionOfWork(
  documentId: string,
  earlier: StoredEntry,
  values: EntryValues,
  context: WriteContext,
): Promise<EntryRecordIds> {
  const editionId = newRecordId('edition')
  const copyId = newRecordId('manifestation')
  return withTenant({ organizationId: context.organizationId }, () =>
    getDb().transaction(async (tx) => {
      const workId = await standaloneWork(tx, earlier, context)
      const ids = { workId, editionId, copyId }
      const header = { organizationId: context.organizationId, documentId, createdBy: context.createdBy }
      await tx.insert(knowledgeRecords).values([
        { ...header, id: editionId, type: 'edition' },
        { ...header, id: copyId, type: 'manifestation' },
      ])
      const bodies = bodiesOf(values, ids, context.terms)
      const common = { organizationId: context.organizationId, createdBy: context.createdBy, provenance: context.provenance }
      await appendRevision(tx, { ...common, recordId: editionId, type: 'edition' }, bodies.edition)
      await appendRevision(tx, { ...common, recordId: copyId, type: 'manifestation' }, bodies.copy)
      return ids
    }),
  ).catch((error: unknown) => {
    if (isUniqueViolation(error)) throw new ConflictError('This document is already recorded as base knowledge; edit that entry instead.')
    throw error
  })
}

export async function deleteWorkIfUnused(organizationId: string, workId: string): Promise<boolean> {
  return withTenant({ organizationId }, async () => {
    const removed = await getDb()
      .delete(knowledgeRecords)
      .where(
        and(
          eq(knowledgeRecords.id, workId),
          eq(knowledgeRecords.organizationId, organizationId),
          eq(knowledgeRecords.type, 'work'),
          isNull(knowledgeRecords.documentId),
          sql`NOT EXISTS (SELECT 1 FROM knowledge_edition_revisions e JOIN knowledge_records r ON r.id = e.record_id
                WHERE e.work_id = ${workId} AND r.type = 'edition')`,
        ),
      )
      .returning({ id: knowledgeRecords.id })
    return removed.length > 0
  })
}
