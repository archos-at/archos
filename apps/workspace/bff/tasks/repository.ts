import 'server-only'
import { and, desc, eq, inArray, isNotNull, isNull, lt, notInArray, or, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withTenant } from '@/lib/db/tenant-context'
import { CURSOR_TIMESTAMP_FORMAT, type DocumentListCursor } from '@/lib/documents/list-cursor'
import { SCHEDULE_SKIPPED_BECAUSE } from '@/lib/projects/project-status'
import type { TaskRunReviewFilter } from './task-wire'
import { TASK_RUN_LIFECYCLE } from './task-vocabulary'
import { documents } from '@/lib/db/schema/documents'
import { taskDefinitions, taskRuns, type NewTaskDefinition, type NewTaskRun, type TaskDefinition, type TaskRun, type TaskRunStatus } from '@/lib/db/schema/task-model'

export const REJECTED_REVIEWS_CARRIED = 3

export const RUN_LIST_LIMIT = 100

export async function insertDefinition(values: NewTaskDefinition): Promise<TaskDefinition> {
  const db = getDb()
  const [row] = await db.insert(taskDefinitions).values(values).returning()
  return row
}

export async function insertDefinitionWithRun(
  definition: NewTaskDefinition,
  run: Omit<NewTaskRun, 'definitionId'>,
): Promise<{ definition: TaskDefinition; run: TaskRun }> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [insertedDefinition] = await tx.insert(taskDefinitions).values(definition).returning()
    const [insertedRun] = await tx
      .insert(taskRuns)
      .values({ ...run, definitionId: insertedDefinition.id })
      .returning()
    return { definition: insertedDefinition, run: insertedRun }
  })
}

function afterCursor(
  createdAt: typeof taskRuns.createdAt | typeof taskDefinitions.createdAt,
  id: typeof taskRuns.id | typeof taskDefinitions.id,
  cursor: DocumentListCursor | null,
): SQL | undefined {
  if (!cursor) return undefined
  return sql`(${createdAt}, ${id}) < ((${cursor.createdAt})::timestamp AT TIME ZONE 'UTC', ${cursor.id}::uuid)`
}

export interface KeysetPage<T> {
  rows: T[]
  next: DocumentListCursor | null
}

function toPage<T extends { id: string }>(
  fetched: Array<{ row: T; cursorAt: string }>,
  limit: number,
): KeysetPage<T> {
  const rows = fetched.slice(0, limit)
  const last = rows.at(-1)
  return {
    rows: rows.map((entry) => entry.row),
    next: fetched.length > limit && last ? { createdAt: last.cursorAt, id: last.row.id } : null,
  }
}

export async function listDefinitionPage(
  projectId: string,
  organizationId: string,
  options: { limit: number; cursor: DocumentListCursor | null },
): Promise<KeysetPage<TaskDefinition>> {
  const db = getDb()
  const fetched = await db
    .select({
      row: taskDefinitions,
      cursorAt: sql<string>`to_char(${taskDefinitions.createdAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`,
    })
    .from(taskDefinitions)
    .where(
      and(
        eq(taskDefinitions.projectId, projectId),
        eq(taskDefinitions.organizationId, organizationId),
        or(sql`${taskDefinitions.trigger} <> 'once'`, isNotNull(taskDefinitions.dueAt)),
        afterCursor(taskDefinitions.createdAt, taskDefinitions.id, options.cursor),
      ),
    )
    .orderBy(desc(taskDefinitions.createdAt), desc(taskDefinitions.id))
    .limit(options.limit + 1)
  return toPage(fetched, options.limit)
}

export interface RunPageFilter {
  definitionId?: string
  status?: TaskRunStatus
  review?: TaskRunReviewFilter
}

function reviewCondition(review: TaskRunReviewFilter | undefined): SQL | undefined {
  if (!review) return undefined
  return review === 'none' ? isNull(taskRuns.review) : eq(taskRuns.review, review)
}

export async function listRunPage(
  projectId: string,
  organizationId: string,
  options: { limit: number; cursor: DocumentListCursor | null } & RunPageFilter,
): Promise<KeysetPage<TaskRun>> {
  const db = getDb()
  const fetched = await db
    .select({
      row: taskRuns,
      cursorAt: sql<string>`to_char(${taskRuns.createdAt} AT TIME ZONE 'UTC', ${CURSOR_TIMESTAMP_FORMAT})`,
    })
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.projectId, projectId),
        eq(taskRuns.organizationId, organizationId),
        options.definitionId ? eq(taskRuns.definitionId, options.definitionId) : undefined,
        options.status ? eq(taskRuns.status, options.status) : undefined,
        reviewCondition(options.review),
        afterCursor(taskRuns.createdAt, taskRuns.id, options.cursor),
      ),
    )
    .orderBy(desc(taskRuns.createdAt), desc(taskRuns.id))
    .limit(options.limit + 1)
  return toPage(fetched, options.limit)
}

export async function findDefinition(
  definitionId: string,
  organizationId: string,
): Promise<TaskDefinition | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(taskDefinitions)
    .where(
      and(
        eq(taskDefinitions.id, definitionId),
        eq(taskDefinitions.organizationId, organizationId),
      ),
    )
    .limit(1)
  return row ?? null
}

export type DefinitionUpdate = Partial<
  Pick<
    TaskDefinition,
    | 'title'
    | 'plan'
    | 'trigger'
    | 'enabled'
    | 'scheduleCron'
    | 'scheduleTimezone'
    | 'nextRunAt'
    | 'dueAt'
    | 'updatedAt'
  >
>

export async function updateDefinition(
  definitionId: string,
  organizationId: string,
  patch: DefinitionUpdate,
): Promise<TaskDefinition | null> {
  const db = getDb()
  const [row] = await db
    .update(taskDefinitions)
    .set(patch)
    .where(
      and(
        eq(taskDefinitions.id, definitionId),
        eq(taskDefinitions.organizationId, organizationId),
      ),
    )
    .returning()
  return row ?? null
}

export async function deleteDefinition(
  definitionId: string,
  organizationId: string,
): Promise<boolean> {
  const db = getDb()
  const deleted = await db
    .delete(taskDefinitions)
    .where(
      and(
        eq(taskDefinitions.id, definitionId),
        eq(taskDefinitions.organizationId, organizationId),
      ),
    )
    .returning({ id: taskDefinitions.id })
  return deleted.length > 0
}

export async function touchDefinitionLastRun(definitionId: string, at: Date): Promise<void> {
  const db = getDb()
  await db
    .update(taskDefinitions)
    .set({ lastRunAt: at })
    .where(eq(taskDefinitions.id, definitionId))
}

export async function rearmOneShotsSkippedWhileParked(projectId: string, organizationId: string): Promise<TaskDefinition[]> {
  const db = getDb()
  const skipped = Object.values(SCHEDULE_SKIPPED_BECAUSE)
  const rows = await withTenant({ organizationId }, () =>
    db
      .update(taskDefinitions)
      .set({ nextRunAt: sql`now()` })
      .where(
        and(
          eq(taskDefinitions.projectId, projectId),
          eq(taskDefinitions.organizationId, organizationId),
          eq(taskDefinitions.trigger, 'once'),
          isNotNull(taskDefinitions.dueAt),
          eq(taskDefinitions.enabled, true),
          sql`${taskDefinitions.nextRunAt} IS NULL`,
          sql`EXISTS (SELECT 1 FROM ${taskRuns} r WHERE r.definition_id = ${taskDefinitions.id} AND r.status = 'skipped' AND r.error IN (${sql.join(
            skipped.map((reason) => sql`${reason}`),
            sql`, `
          )}))`,
          sql`NOT EXISTS (SELECT 1 FROM ${taskRuns} r WHERE r.definition_id = ${taskDefinitions.id} AND r.status <> 'skipped')`
        )
      )
      .returning()
  )
  return rows
}

export interface SubjectDocumentPlace {
  projectId: string | null
  folderId: string | null
}

const SUBJECT_LOOKUP_LIMIT = 500

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function findSubjectDocumentPlaces(
  organizationId: string,
  documentIds: readonly string[],
): Promise<Map<string, SubjectDocumentPlace>> {
  const uuids = [...new Set(documentIds)].filter((id) => UUID_PATTERN.test(id)).slice(0, SUBJECT_LOOKUP_LIMIT)
  if (uuids.length === 0) return new Map()
  const db = getDb()
  const rows = await db
    .select({ id: documents.id, projectId: documents.projectId, folderId: documents.folderId })
    .from(documents)
    .where(and(eq(documents.organizationId, organizationId), inArray(documents.id, uuids)))
    .limit(SUBJECT_LOOKUP_LIMIT)
  return new Map(rows.map((row) => [String(row.id), { projectId: row.projectId ?? null, folderId: row.folderId ?? null }]))
}

export async function listRunsByIds(organizationId: string, runIds: readonly string[]): Promise<TaskRun[]> {
  const uuids = [...new Set(runIds)].filter((id) => UUID_PATTERN.test(id)).slice(0, SUBJECT_LOOKUP_LIMIT)
  if (uuids.length === 0) return []
  const db = getDb()
  return db
    .select()
    .from(taskRuns)
    .where(and(eq(taskRuns.organizationId, organizationId), inArray(taskRuns.id, uuids)))
    .limit(SUBJECT_LOOKUP_LIMIT)
}

export async function insertRun(values: NewTaskRun): Promise<TaskRun> {
  const db = getDb()
  const [row] = await db.insert(taskRuns).values(values).returning()
  return row
}

export async function findRunInProject(
  runId: string,
  projectId: string,
  organizationId: string,
): Promise<TaskRun | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.id, runId),
        eq(taskRuns.projectId, projectId),
        eq(taskRuns.organizationId, organizationId),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function listRunsInProject(
  projectId: string,
  organizationId: string,
  limit = RUN_LIST_LIMIT,
): Promise<TaskRun[]> {
  const db = getDb()
  return db
    .select()
    .from(taskRuns)
    .where(
      and(eq(taskRuns.projectId, projectId), eq(taskRuns.organizationId, organizationId)),
    )
    .orderBy(desc(taskRuns.createdAt))
    .limit(limit)
}

export async function countActiveRunsInProject(projectId: string, organizationId: string): Promise<number> {
  const db = getDb()
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.projectId, projectId),
        eq(taskRuns.organizationId, organizationId),
        inArray(taskRuns.status, [...ACTIVE_RUN_STATUSES]),
      ),
    )
  return Number(row?.n ?? 0)
}

export async function findRunById(runId: string): Promise<TaskRun | null> {
  const db = getDb()
  const [row] = await db.select().from(taskRuns).where(eq(taskRuns.id, runId)).limit(1)
  return row ?? null
}

export async function findRunByBackendJobId(backendJobId: string): Promise<TaskRun | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(taskRuns)
    .where(eq(taskRuns.backendJobId, backendJobId))
    .limit(1)
  return row ?? null
}

export async function updateRun(
  runId: string,
  organizationId: string,
  patch: Partial<Omit<NewTaskRun, 'id' | 'organizationId' | 'projectId'>>,
): Promise<TaskRun | null> {
  const db = getDb()
  const [row] = await db
    .update(taskRuns)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(taskRuns.id, runId), eq(taskRuns.organizationId, organizationId)))
    .returning()
  return row ?? null
}

export async function markRunStarted(
  runId: string,
  organizationId: string,
  startedAt: Date,
): Promise<boolean> {
  const db = getDb()
  const rows = await db
    .update(taskRuns)
    .set({ status: 'running', startedAt, updatedAt: new Date() })
    .where(
      and(
        eq(taskRuns.id, runId),
        eq(taskRuns.organizationId, organizationId),
        inArray(taskRuns.status, [...TASK_RUN_LIFECYCLE.sourcesOf('start')]),
      ),
    )
    .returning({ id: taskRuns.id })
  return rows.length > 0
}

const ACTIVE_RUN_STATUSES = TASK_RUN_LIFECYCLE.liveStates

export async function closeActiveRun(
  runId: string,
  organizationId: string,
  patch: Pick<NewTaskRun, 'status' | 'error'>,
): Promise<TaskRun | null> {
  const db = getDb()
  const [row] = await db
    .update(taskRuns)
    .set({ ...patch, finishedAt: sql`now()`, updatedAt: new Date() })
    .where(
      and(
        eq(taskRuns.id, runId),
        eq(taskRuns.organizationId, organizationId),
        inArray(taskRuns.status, [...ACTIVE_RUN_STATUSES]),
      ),
    )
    .returning()
  return row ?? null
}

export async function claimRunsToReconcile(
  checkedBefore: Date,
  limit: number,
): Promise<TaskRun[]> {
  const db = getDb()
  const age = sql`COALESCE(${taskRuns.reconcileCheckedAt}, ${taskRuns.startedAt}, ${taskRuns.createdAt})`
  const due = db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(and(inArray(taskRuns.status, [...ACTIVE_RUN_STATUSES]), lt(age, checkedBefore.toISOString())))
    .orderBy(age)
    .limit(limit)
    .for('update', { skipLocked: true })
  return db
    .update(taskRuns)
    .set({ reconcileCheckedAt: sql`now()` })
    .where(inArray(taskRuns.id, due))
    .returning()
}

export async function listRunsWithStaleQueuedFiling(before: Date, limit: number): Promise<TaskRun[]> {
  const db = getDb()
  const aliveJob = sql`EXISTS (
    SELECT 1 FROM bff_job_queue j
    WHERE j.kind = 'file_research_report'
      AND j.lane = ${taskRuns.organizationId}
      AND j.payload ->> 'runId' = ${taskRuns.backendJobId}
      AND j.status <> 'dead'
  )`
  return db
    .select()
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.filingStatus, 'queued'),
        lt(sql`COALESCE(${taskRuns.finishedAt}, ${taskRuns.updatedAt})`, before.toISOString()),
        sql`NOT ${aliveJob}`,
      ),
    )
    .orderBy(sql`COALESCE(${taskRuns.finishedAt}, ${taskRuns.updatedAt})`)
    .limit(limit)
}

export async function settleQueuedFiling(
  runId: string,
  organizationId: string,
  patch: Pick<NewTaskRun, 'filingStatus' | 'filingDetail' | 'filedDocumentId'>,
): Promise<TaskRun | null> {
  const [row] = await getDb()
    .update(taskRuns)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(eq(taskRuns.id, runId), eq(taskRuns.organizationId, organizationId), eq(taskRuns.filingStatus, 'queued')),
    )
    .returning()
  return row ?? null
}

export async function claimClosedRunsToHeal(limit: number): Promise<TaskRun[]> {
  const db = getDb()
  const ended = sql`COALESCE(${taskRuns.finishedAt}, ${taskRuns.updatedAt})`
  const due = db
    .select({ id: taskRuns.id })
    .from(taskRuns)
    .where(
      and(
        notInArray(taskRuns.status, [...ACTIVE_RUN_STATUSES]),
        isNotNull(taskRuns.runMessageId),
        sql`(${taskRuns.reconcileCheckedAt} IS NULL OR ${taskRuns.reconcileCheckedAt} < ${ended})`,
      ),
    )
    .orderBy(ended)
    .limit(limit)
    .for('update', { skipLocked: true })
  return db
    .update(taskRuns)
    .set({ reconcileCheckedAt: sql`now()` })
    .where(inArray(taskRuns.id, due))
    .returning()
}

export async function releaseHealClaim(runId: string): Promise<void> {
  await getDb().update(taskRuns).set({ reconcileCheckedAt: null }).where(eq(taskRuns.id, runId))
}

export async function listRejectedReviewsForDefinition(
  definitionId: string,
  organizationId: string,
): Promise<Array<Pick<TaskRun, 'id' | 'reviewReason' | 'reviewedAt' | 'reviewedBy'>>> {
  const db = getDb()
  return db
    .select({
      id: taskRuns.id,
      reviewReason: taskRuns.reviewReason,
      reviewedAt: taskRuns.reviewedAt,
      reviewedBy: taskRuns.reviewedBy,
    })
    .from(taskRuns)
    .where(
      and(
        eq(taskRuns.definitionId, definitionId),
        eq(taskRuns.organizationId, organizationId),
        eq(taskRuns.review, 'rejected'),
        isNotNull(taskRuns.reviewReason),
      ),
    )
    .orderBy(desc(taskRuns.reviewedAt))
    .limit(REJECTED_REVIEWS_CARRIED)
}
