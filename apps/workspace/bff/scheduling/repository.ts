import 'server-only'
import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { withPlatformAccess } from '@/lib/db/tenant-context'
import { taskDefinitions, type TaskDefinition } from '@/lib/db/schema/task-model'

export interface DueAdvance {
  nextRunAt: Date | null
  enabled: boolean
  fire: boolean
}

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
