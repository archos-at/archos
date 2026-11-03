/**
 * Scheduling's SQL over `task_definitions` (ADR-0017: SQL only). When a
 * definition is due lives in `next_run_at`; which Hatchet scheduled run fires it
 * lives in `scheduled_run_id` (migration 0192).
 */

import 'server-only'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { taskDefinitions, type TaskDefinition } from '@/lib/db/schema/task-model'

/** What a fire does to the row it found due: where `next_run_at` goes, and whether the run starts. */
export interface DueAdvance {
  nextRunAt: Date | null
  enabled: boolean
  fire: boolean
}

/**
 * Take one occurrence of a definition: lock the row if it is enabled and still
 * due at exactly `dueAt`, move `next_run_at` on as `advance` says, and commit.
 * Null when the row is not due at that time any more, which is what makes a
 * fire idempotent per definition and due time: a second fire of the same
 * occurrence (a Hatchet redelivery, a repair that raced the scheduled run, a
 * run left over from an earlier edit) finds `next_run_at` moved and records
 * nothing. The caller starts the run only after this has committed, so a crash
 * in between misses one occurrence rather than running it twice.
 *
 * Compared at millisecond precision: `next_run_at` can hold microseconds (a
 * `now()` written by SQL) that a JavaScript `Date` in a task input cannot carry.
 */
export async function advanceDueDefinition(
  definitionId: string,
  organizationId: string,
  dueAt: Date,
  advance: (definition: TaskDefinition) => DueAdvance,
): Promise<{ definition: TaskDefinition; fire: boolean } | null> {
  const db = getDb()
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(taskDefinitions)
      .where(
        and(
          eq(taskDefinitions.id, definitionId),
          eq(taskDefinitions.organizationId, organizationId),
          eq(taskDefinitions.enabled, true),
          sql`date_trunc('milliseconds', ${taskDefinitions.nextRunAt}) = date_trunc('milliseconds', ${dueAt.toISOString()}::timestamptz)`,
        ),
      )
      .limit(1)
      .for('update')
    if (!row) return null
    const step = advance(row)
    const [updated] = await tx
      .update(taskDefinitions)
      .set({ nextRunAt: step.nextRunAt, enabled: step.enabled })
      .where(eq(taskDefinitions.id, row.id))
      .returning()
    return { definition: updated, fire: step.fire }
  })
}

/** Remember which scheduled run fires the definition next (null: none). */
export async function setScheduledRunId(
  definitionId: string,
  organizationId: string,
  scheduledRunId: string | null,
): Promise<void> {
  const db = getDb()
  await db
    .update(taskDefinitions)
    .set({ scheduledRunId })
    .where(and(eq(taskDefinitions.id, definitionId), eq(taskDefinitions.organizationId, organizationId)))
}

/**
 * Enabled definitions with a due time that need a scheduled run, oldest due
 * first: those whose due time passed more than `graceMinutes` ago (the run was
 * never created, was lost, or timed out in Hatchet's queue while no worker was
 * up), and those with no scheduled run at all, however far ahead they are due
 * (every definition from before the cutover, migration 0192). Every
 * organization's, so it runs under the platform scope; the repair then works
 * on each row inside its own organization. The WHERE clause implies the
 * partial index `idx_task_definitions_due` (0090), and the limit bounds it.
 */
export function findDefinitionsToRepair(graceMinutes: number, limit: number): Promise<TaskDefinition[]> {
  return withPlatformAccess('schedule repair: find the definitions that are overdue or have no scheduled run', () =>
    getDb()
      .select()
      .from(taskDefinitions)
      .where(
        and(
          eq(taskDefinitions.enabled, true),
          sql`${taskDefinitions.nextRunAt} IS NOT NULL`,
          or(
            isNull(taskDefinitions.scheduledRunId),
            sql`${taskDefinitions.nextRunAt} < now() - make_interval(mins => ${graceMinutes})`,
          ),
        ),
      )
      .orderBy(taskDefinitions.nextRunAt)
      .limit(limit),
  )
}
