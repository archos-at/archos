/**
 * Capacity eviction of the active lesson set: its own file because the
 * operator's activation and the eviction it triggers share one transaction.
 * Runs inside `withPlatformAccess` (the service holds it), like the repository.
 */
import 'server-only'
import { desc, eq, inArray } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { platformLessonEvents, platformLessons, type PlatformLesson } from '@/lib/db/schema/platform-lessons'
import { selectCapacityEvictions } from './capacity'
import type { updateLessonWithEvent } from './repository'

type Tx = Parameters<Parameters<ReturnType<typeof getDb>['transaction']>[0]>[0]

async function evictOverCapacityIn(
  tx: Tx,
  maxActive: number,
  actor: string,
  protectedId?: string
): Promise<string[]> {
  const active = await tx
    .select({ id: platformLessons.id })
    .from(platformLessons)
    .where(eq(platformLessons.status, 'active'))
    .orderBy(desc(platformLessons.lastReportedAt), desc(platformLessons.reportCount))
  const excess = selectCapacityEvictions(active, maxActive, protectedId)
  if (excess.length === 0) return []
  const now = new Date()
  await tx
    .update(platformLessons)
    .set({
      status: 'retired',
      retiredAt: now,
      retiredBy: actor,
      retiredReason: 'evicted_capacity',
      updatedAt: now,
    })
    .where(inArray(platformLessons.id, excess))
  await tx.insert(platformLessonEvents).values(
    excess.map((id) => ({
      lessonId: id,
      action: 'retired' as const,
      actor,
      detail: { reason: 'evicted_capacity' },
    }))
  )
  return excess
}

/**
 * Retire the least-recently-reported active lessons beyond `maxActive`
 * (capacity eviction, each with its own event). Returns the ids retired.
 */
export async function evictActiveOverCapacity(maxActive: number, actor: string): Promise<string[]> {
  return getDb().transaction((tx) => evictOverCapacityIn(tx, maxActive, actor))
}

/**
 * An operator's activation: the status change, its event and the capacity
 * eviction are ONE transaction, and the activated lesson is protected from its
 * own eviction (the stalest OTHER active lesson gives way). Returns the row as
 * stored after all of it, plus the ids evicted.
 */
export async function activateLessonWithCapacity(
  lessonId: string,
  patch: Parameters<typeof updateLessonWithEvent>[1],
  event: Parameters<typeof updateLessonWithEvent>[2],
  maxActive: number
): Promise<{ row: PlatformLesson; evictedIds: string[] } | null> {
  return getDb().transaction(async (tx) => {
    const [updated] = await tx
      .update(platformLessons)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(platformLessons.id, lessonId))
      .returning()
    if (!updated) return null
    await tx.insert(platformLessonEvents).values({ ...event, lessonId })
    const evictedIds = await evictOverCapacityIn(tx, maxActive, event.actor, lessonId)
    return { row: updated, evictedIds }
  })
}
