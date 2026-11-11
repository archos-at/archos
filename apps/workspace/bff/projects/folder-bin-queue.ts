/**
 * The Papierkorb's queue row (`deletion_queue`, `entity_type = 'folder'`): what
 * it carries, and every write of it the BFF makes. The moves are the
 * deletion lifecycle's (`DELETION_LIFECYCLE`, ADR-0179); the purger makes the
 * same ones from `purger/db.js`.
 *
 * Split from `folder-bin-repository.ts`, which re-exports it: organization in
 * every WHERE, and a function that runs inside a caller's transaction takes
 * its executor.
 */

import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { withTenant } from '@/lib/db/tenant-context'
import { DELETION_LIFECYCLE, DELETION_MAX_ATTEMPTS, deletionQueue, type DeletionStatus } from '@/lib/db/schema/deletion-queue'

/** What the bin entry's queue row carries besides its columns. No content: ids and counts. */
export interface FolderBinPayload {
  projectId: string
  folderIds: string[]
  documents: number
  /**
   * When every document's chunks were confirmed purged. Absent while the
   * delete's purge is unfinished: the request that binned the folder died
   * before it was done, and its `purge_binned_chunks` job finishes it.
   */
  chunksPurgedAt?: string
  /** Set when the purge removed what was derived from the folder („Mit dem Ordner entfernen"): the ids. */
  derivedRemoval?: DerivedRemovalRecord
  /** What a purge removed, counted. */
  purged?: FolderPurgeCounts
  /**
   * The document this entry was made for, when one document went to the bin
   * on its own (`document-bin.ts`): the folder is the document's holder, and
   * restoring the document takes it back out.
   */
  documentId?: string
}

export interface FolderPurgeCounts {
  documents: number
  folders: number
  memoryNotes: number
  answers: number
  conversations: number
  reports: number
  tracesErased: number
}

/** What a purge under „Mit dem Ordner entfernen" removed: ids and when, never content. */
export interface DerivedRemovalRecord {
  removedAt: string
  /** The ids of what the removal touched; never their content. */
  conversationIds?: string[]
  messageIds?: string[]
  memoryIds?: string[]
  reportIds?: string[]
}

/** Insert the bin entry's queue row. */
export async function insertFolderBinEntry(
  tx: DbExecutor,
  entry: {
    organizationId: string
    folderId: string
    displayName: string
    requestedBy: string
    purgeAfter: Date
    payload: FolderBinPayload
  }
): Promise<string> {
  const [row] = await tx
    .insert(deletionQueue)
    .values({
      entityType: 'folder',
      entityId: entry.folderId,
      displayName: entry.displayName,
      organizationId: entry.organizationId,
      requestedBy: entry.requestedBy,
      purgeAfter: entry.purgeAfter,
      payload: { ...entry.payload },
    })
    .returning({ id: deletionQueue.id })
  return row.id
}

/** A bin entry's queue row by its id, in any state; null when it is not the organization's folder entry. */
export async function findBinEntryById(organizationId: string, entryId: string): Promise<FolderQueueRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .select()
      .from(deletionQueue)
      .where(
        and(eq(deletionQueue.id, entryId), eq(deletionQueue.entityType, 'folder'), eq(deletionQueue.organizationId, organizationId))
      )
      .limit(1)
  )
  return row ?? null
}

export type FolderQueueRow = typeof deletionQueue.$inferSelect

/** The live (pending or purging) queue row of a bin entry. */
export async function findActiveBinEntry(
  executor: DbExecutor,
  organizationId: string,
  folderId: string
): Promise<FolderQueueRow | null> {
  const [row] = await executor
    .select()
    .from(deletionQueue)
    .where(
      and(
        eq(deletionQueue.entityType, 'folder'),
        eq(deletionQueue.entityId, folderId),
        eq(deletionQueue.organizationId, organizationId),
        inArray(deletionQueue.status, DELETION_LIFECYCLE.liveStates)
      )
    )
    .limit(1)
  return row ?? null
}

/**
 * Close a bin entry as restored. Only a row the purger has never claimed: one
 * it has claimed may have erased documents already, and a half-restored folder
 * is worse than a refusal.
 */
export async function closeBinEntryRestored(tx: DbExecutor, organizationId: string, folderId: string): Promise<boolean> {
  const rows = await tx
    .update(deletionQueue)
    .set({ status: 'restored' })
    .where(
      and(
        eq(deletionQueue.entityType, 'folder'),
        eq(deletionQueue.entityId, folderId),
        eq(deletionQueue.organizationId, organizationId),
        inArray(deletionQueue.status, DELETION_LIFECYCLE.sourcesOf('restore')),
        isNull(deletionQueue.claimedAt)
      )
    )
    .returning({ id: deletionQueue.id })
  return rows.length > 0
}

/**
 * Claim a bin entry for a purge run in the request („Endgültig löschen"):
 * `pending` to `purging`, as the purger's claim does, or a `failed` one a
 * person tries again. Null when the purger holds it, or it is gone.
 */
export async function claimBinEntryNow(organizationId: string, folderId: string): Promise<FolderQueueRow | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(deletionQueue)
      .set({ status: 'purging', claimedAt: new Date(), attempts: sql`${deletionQueue.attempts} + 1` })
      .where(
        and(
          eq(deletionQueue.entityType, 'folder'),
          eq(deletionQueue.entityId, folderId),
          eq(deletionQueue.organizationId, organizationId),
          inArray(deletionQueue.status, DELETION_LIFECYCLE.statesThatMayBecome('purging'))
        )
      )
      .returning()
  )
  return row ?? null
}

/** What a failed attempt leaves a claimed row as: the purger's own rule (`markFailed`, `purger/db.js`). */
const RELEASED_STATUS = sql<DeletionStatus>`CASE WHEN ${deletionQueue.attempts} >= ${DELETION_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`

/** Finish a claimed bin entry: `purged`, with what was removed merged into its payload. */
export async function closeBinEntryPurged(
  organizationId: string,
  folderId: string,
  payload: Partial<FolderBinPayload>
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(deletionQueue)
      .set({
        status: 'purged',
        purgedAt: new Date(),
        lastError: null,
        payload: sql`coalesce(${deletionQueue.payload}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
      })
      .where(
        and(
          eq(deletionQueue.entityType, 'folder'),
          eq(deletionQueue.entityId, folderId),
          eq(deletionQueue.organizationId, organizationId),
          eq(deletionQueue.status, 'purging')
        )
      )
  )
}

/**
 * Put a claimed bin entry back after a purge in the request failed: `pending`,
 * for the purger to retry, while it has attempts left, else `failed`. The
 * purger never claims a row at the cap, so a `pending` one there would wait
 * for ever while reading as waiting.
 */
export async function releaseBinEntry(organizationId: string, folderId: string, error: string): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(deletionQueue)
      .set({ status: RELEASED_STATUS, lastError: error.slice(0, 2000) })
      .where(
        and(
          eq(deletionQueue.entityType, 'folder'),
          eq(deletionQueue.entityId, folderId),
          eq(deletionQueue.organizationId, organizationId),
          eq(deletionQueue.status, 'purging')
        )
      )
  )
}

/**
 * Give a claimed bin entry whose purge is done to the purger, for the one step
 * the BFF does not take: erasing the Langfuse traces of the conversations the
 * removal touched. The BFF has neither Langfuse's credentials nor a network
 * path to it (`deploy/pulumi`); the purger has both. Due now, never claimed and
 * its attempts started over (a row a person retried at the cap would otherwise
 * never be claimed), so the purger takes it on its next tick:
 * its purge call finds the folder purged and answers with the conversations
 * whose traces are owed (`purgeBinnedFolder`), and it closes the row.
 */
export async function handBinEntryToPurger(
  organizationId: string,
  folderId: string,
  payload: Partial<FolderBinPayload>
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(deletionQueue)
      .set({
        status: 'pending',
        purgeAfter: sql`least(${deletionQueue.purgeAfter}, now())`,
        claimedAt: null,
        attempts: 0,
        lastError: null,
        payload: sql`coalesce(${deletionQueue.payload}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb`,
      })
      .where(
        and(
          eq(deletionQueue.entityType, 'folder'),
          eq(deletionQueue.entityId, folderId),
          eq(deletionQueue.organizationId, organizationId),
          eq(deletionQueue.status, 'purging')
        )
      )
  )
}

/** Merge into a live bin entry's payload (the purge records what it removed as it goes). */
export async function mergeBinEntryPayload(
  organizationId: string,
  folderId: string,
  payload: Partial<FolderBinPayload>
): Promise<void> {
  const db = getDb()
  await withTenant({ organizationId }, () =>
    db
      .update(deletionQueue)
      .set({ payload: sql`coalesce(${deletionQueue.payload}, '{}'::jsonb) || ${JSON.stringify(payload)}::jsonb` })
      .where(
        and(
          eq(deletionQueue.entityType, 'folder'),
          eq(deletionQueue.entityId, folderId),
          eq(deletionQueue.organizationId, organizationId),
          inArray(deletionQueue.status, DELETION_LIFECYCLE.liveStates)
        )
      )
  )
}
