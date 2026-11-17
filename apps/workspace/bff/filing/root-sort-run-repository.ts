import 'server-only'
import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { bffJobQueue } from '@/lib/db/schema/bff-job-queue'
import { rootSortRuns, type RootSortRun } from '@/lib/db/schema/root-sort-runs'
import { withTenant } from '@/lib/db/tenant-context'
import type { DocumentShelf } from '@/lib/documents/shelf'
import { ROOT_SORT_WORKING_STATUSES, type RootSortRunStatus } from './root-sort-types'

export type NewRootSortRun = Pick<
  typeof rootSortRuns.$inferInsert,
  'organizationId' | 'scope' | 'projectId' | 'requestedBy' | 'status' | 'documentIds' | 'unreadable' | 'truncated'
>

export type RootSortRunPatch = Partial<
  Pick<
    RootSortRun,
    | 'status'
    | 'cursor'
    | 'progressDone'
    | 'placements'
    | 'failedDocumentIds'
    | 'newFolders'
    | 'keptMoves'
    | 'movedDocuments'
    | 'jobId'
    | 'moveFailures'
    | 'undoFailures'
    | 'error'
    | 'groupingError'
    | 'finishedAt'
  >
>

export async function insertRootSortRun(run: NewRootSortRun): Promise<RootSortRun> {
  const [row] = await withTenant({ organizationId: run.organizationId }, () =>
    getDb().insert(rootSortRuns).values(run).returning()
  )
  return row
}

export async function findRootSortRun(organizationId: string, runId: string): Promise<RootSortRun | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(rootSortRuns)
      .where(and(eq(rootSortRuns.organizationId, organizationId), eq(rootSortRuns.id, runId)))
      .limit(1)
  )
  return row ?? null
}

export async function findLatestRootSortRun(
  organizationId: string,
  shelf: DocumentShelf,
  requestedBy: string
): Promise<RootSortRun | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select()
      .from(rootSortRuns)
      .where(
        and(
          eq(rootSortRuns.organizationId, organizationId),
          eq(rootSortRuns.scope, shelf.kind),
          shelf.kind === 'project' ? eq(rootSortRuns.projectId, shelf.projectId) : isNull(rootSortRuns.projectId),
          eq(rootSortRuns.requestedBy, requestedBy)
        )
      )
      .orderBy(desc(rootSortRuns.createdAt))
      .limit(1)
  )
  return row ?? null
}

export async function updateRootSortRun(
  organizationId: string,
  runId: string,
  from: readonly RootSortRunStatus[],
  patch: RootSortRunPatch,
  expected: { cursor?: number } = {}
): Promise<RootSortRun | null> {
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .update(rootSortRuns)
      .set({ ...patch, updatedAt: sql`now()` })
      .where(
        and(
          eq(rootSortRuns.organizationId, organizationId),
          eq(rootSortRuns.id, runId),
          inArray(rootSortRuns.status, [...from]),
          expected.cursor === undefined ? undefined : eq(rootSortRuns.cursor, expected.cursor)
        )
      )
      .returning()
  )
  return row ?? null
}

export async function recordRootSortProgress(
  organizationId: string,
  runId: string,
  expected: { status: RootSortRunStatus; cursor: number },
  done: number
): Promise<void> {
  await withTenant({ organizationId }, () =>
    getDb()
      .update(rootSortRuns)
      .set({ progressDone: sql`GREATEST(${rootSortRuns.progressDone}, ${done})`, updatedAt: sql`now()` })
      .where(
        and(
          eq(rootSortRuns.organizationId, organizationId),
          eq(rootSortRuns.id, runId),
          eq(rootSortRuns.status, expected.status),
          eq(rootSortRuns.cursor, expected.cursor)
        )
      )
  )
}

export async function isRootSortJobWaiting(organizationId: string, jobId: string | null): Promise<boolean> {
  if (jobId === null) return false
  const [row] = await withTenant({ organizationId }, () =>
    getDb()
      .select({ status: bffJobQueue.status })
      .from(bffJobQueue)
      .where(and(eq(bffJobQueue.jobId, jobId), eq(bffJobQueue.lane, organizationId)))
      .limit(1)
  )
  return row?.status === 'queued'
}

export const STALL_GRACE_MS = 2 * 60 * 1000

export async function failStalledRootSortRuns(organizationId: string, shelf: DocumentShelf): Promise<RootSortRun[]> {
  return withTenant({ organizationId }, () =>
    getDb()
      .update(rootSortRuns)
      .set({ status: 'failed', error: 'stalled', finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(rootSortRuns.organizationId, organizationId),
          eq(rootSortRuns.scope, shelf.kind),
          shelf.kind === 'project' ? eq(rootSortRuns.projectId, shelf.projectId) : isNull(rootSortRuns.projectId),
          inArray(rootSortRuns.status, [...ROOT_SORT_WORKING_STATUSES]),
          lt(rootSortRuns.updatedAt, sql`now() - make_interval(secs => ${STALL_GRACE_MS / 1000})`),
          sql`NOT EXISTS (
            SELECT 1 FROM ${bffJobQueue}
            WHERE ${bffJobQueue.jobId} = ${rootSortRuns.jobId}
              AND ${bffJobQueue.lane} = ${organizationId}
              AND ${bffJobQueue.status} IN ('queued', 'claimed')
          )`
        )
      )
      .returning()
  )
}

export async function cancelReadyRootSortRuns(
  organizationId: string,
  shelf: DocumentShelf,
  requestedBy: string
): Promise<RootSortRun[]> {
  return withTenant({ organizationId }, () =>
    getDb()
      .update(rootSortRuns)
      .set({ status: 'cancelled', finishedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(rootSortRuns.organizationId, organizationId),
          eq(rootSortRuns.scope, shelf.kind),
          shelf.kind === 'project' ? eq(rootSortRuns.projectId, shelf.projectId) : isNull(rootSortRuns.projectId),
          eq(rootSortRuns.requestedBy, requestedBy),
          eq(rootSortRuns.status, 'ready')
        )
      )
      .returning()
  )
}
