import 'server-only'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import type { DbExecutor } from '@/lib/db/executor'
import { withTenant } from '@/lib/db/tenant-context'
import { DELETION_LIFECYCLE, DELETION_MAX_ATTEMPTS, deletionQueue, type DeletionStatus } from '@/lib/db/schema/deletion-queue'

export interface FolderBinPayload {
  projectId: string
  folderIds: string[]
  documents: number
  chunksPurgedAt?: string
  derivedRemoval?: DerivedRemovalRecord
  purged?: FolderPurgeCounts
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

export interface DerivedRemovalRecord {
  removedAt: string
  conversationIds?: string[]
  messageIds?: string[]
  memoryIds?: string[]
  reportIds?: string[]
}

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

export type BinEntryClaim = string

const heldBy = (claim: BinEntryClaim) => sql`${deletionQueue.claimedAt} = ${claim}::text::timestamptz`

export async function claimBinEntryNow(organizationId: string, folderId: string): Promise<BinEntryClaim | null> {
  const db = getDb()
  const [row] = await withTenant({ organizationId }, () =>
    db
      .update(deletionQueue)
      .set({ status: 'purging', claimedAt: sql`now()`, attempts: sql`${deletionQueue.attempts} + 1` })
      .where(
        and(
          eq(deletionQueue.entityType, 'folder'),
          eq(deletionQueue.entityId, folderId),
          eq(deletionQueue.organizationId, organizationId),
          inArray(deletionQueue.status, DELETION_LIFECYCLE.statesThatMayBecome('purging'))
        )
      )
      .returning({ claim: sql<string>`${deletionQueue.claimedAt}::text` })
  )
  return row?.claim ?? null
}

const RELEASED_STATUS = sql<DeletionStatus>`CASE WHEN ${deletionQueue.attempts} >= ${DELETION_MAX_ATTEMPTS} THEN 'failed' ELSE 'pending' END`

export async function closeBinEntryPurged(
  organizationId: string,
  folderId: string,
  claim: BinEntryClaim,
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
          inArray(deletionQueue.status, ['purging', 'failed']),
          heldBy(claim)
        )
      )
  )
}

export async function releaseBinEntry(
  organizationId: string,
  folderId: string,
  claim: BinEntryClaim,
  error: string
): Promise<void> {
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
          eq(deletionQueue.status, 'purging'),
          heldBy(claim)
        )
      )
  )
}

export async function handBinEntryToPurger(
  organizationId: string,
  folderId: string,
  claim: BinEntryClaim,
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
          eq(deletionQueue.status, 'purging'),
          heldBy(claim)
        )
      )
  )
}

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
