/**
 * A newer edition of a standard the office already holds, as the platform holds
 * one (ADR-0163 amendment, 2026-11): a second edition record under the SAME
 * work, with its own copy and document, so `time/editions.ts` picks the one in
 * force on a day exactly as it does for the platform's editions.
 *
 * An office entry's work was created with its first document
 * (`knowledge_records.document_id`), and an edition's revision references its
 * work with ON DELETE CASCADE: removing the first document would take the work
 * and, with it, every later edition's revisions. So before a second edition
 * joins, the work is made to stand alone (`document_id` NULL): a new work
 * record with the same values, and a new revision of the first edition naming
 * it (revisions are only ever appended, migration 0202). Each edition then goes
 * with its own document, and the work goes when the last edition has
 * ({@link deleteWorkIfUnused}).
 */

import 'server-only'
import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { isUniqueViolation } from '@/lib/db/errors'
import { ConflictError } from '@/lib/api/errors'
import { knowledgeRecords } from '@/lib/db/schema/knowledge-records'
import type { EntryValues } from '../wire'
import { appendRevision, bodiesOf, newRecordId, type EntryRecordIds, type StoredEntry, type Tx, type WriteContext } from './repository'

async function moveHead(tx: Tx, recordId: string, revisionId: string): Promise<void> {
  await tx.update(knowledgeRecords).set({ headRevisionId: revisionId }).where(eq(knowledgeRecords.id, recordId))
}

/**
 * The work `earlier` belongs to, standing alone: its own id when it already
 * does, else a new standalone work with its values, the earlier edition's new
 * revision naming it. Confirmed heads move with it; a proposal stays one.
 */
async function standaloneWork(tx: Tx, earlier: StoredEntry, context: WriteContext): Promise<string> {
  if (earlier.workStandsAlone) return earlier.workId
  const workId = newRecordId('work')
  const ids = { workId, editionId: earlier.editionId, copyId: earlier.copyId }
  const bodies = bodiesOf(earlier.values, ids, earlier.terms)
  const common = { organizationId: context.organizationId, createdBy: context.createdBy, provenance: earlier.provenance }
  await tx.insert(knowledgeRecords).values({ id: workId, type: 'work', organizationId: context.organizationId, documentId: null, createdBy: context.createdBy })
  const workRevision = await appendRevision(tx, { ...common, recordId: workId, type: 'work' }, bodies.work)
  const editionRevision = await appendRevision(tx, { ...common, recordId: earlier.editionId, type: 'edition' }, bodies.edition)
  if (earlier.confirmed) {
    await moveHead(tx, workId, workRevision)
    await moveHead(tx, earlier.editionId, editionRevision)
  }
  return workId
}

/**
 * A newer edition of `earlier`'s work for one office shelf document: its edition
 * and copy records, proposed (no heads), under the work made to stand alone.
 * The work's values are the work's; the edition and the copy are the new one's.
 */
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

/**
 * Remove a standalone work once no edition names it any more: the last
 * edition's document is gone, so is everything of the standard. A work that
 * still has an edition, or belongs to a document, stays.
 */
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
