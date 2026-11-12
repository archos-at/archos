import 'server-only'
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { personalMemory, type NewPersonalMemoryItem, type PersonalMemoryItem } from '@/lib/db/schema/personal-memory'

/**
 * The SQL of personal memory (ADR-0180). Every statement names the owner, and
 * the table's row-level security names them again: the WHERE is for the reader
 * of this file, the policy for the day somebody forgets one.
 */

/** One person's notes inside one organization. */
export interface PersonalMemoryOwner {
  organizationId: string
  userId: string
}

/**
 * Narrows a list. `sourceConversationId`: the notes saved from one conversation.
 * `topic`: the notes on that topic; null is the notes with no topic; undefined is no filter.
 */
export interface PersonalMemoryFilter {
  sourceConversationId?: string
  topic?: string | null
}

/** The most notes one page answers: the page limit of `@/lib/api/offset-page`. */
export const PERSONAL_MEMORY_LIST_LIMIT = 200

function ownedBy(owner: PersonalMemoryOwner) {
  return and(eq(personalMemory.organizationId, owner.organizationId), eq(personalMemory.userId, owner.userId))
}

/** The conditions a list's filter adds to the owner's rows; none for an empty filter. */
function filterConditions(filter: PersonalMemoryFilter): SQL[] {
  const conditions: SQL[] = []
  if (filter.sourceConversationId) {
    conditions.push(eq(personalMemory.sourceConversationId, filter.sourceConversationId))
  }
  if (filter.topic === null) conditions.push(isNull(personalMemory.topic))
  else if (filter.topic !== undefined) conditions.push(eq(personalMemory.topic, filter.topic))
  return conditions
}

/**
 * Pinned first, then newest: the order of the panel and of the turn's block.
 * The id closes the order, so two notes written in one instant keep their
 * places from page to page. Bounded: at most one row past the page limit,
 * which is how a caller learns that another page follows.
 */
export async function selectPersonalMemory(
  owner: PersonalMemoryOwner,
  limit: number = PERSONAL_MEMORY_LIST_LIMIT,
  offset: number = 0,
  filter: PersonalMemoryFilter = {}
): Promise<PersonalMemoryItem[]> {
  return getDb()
    .select()
    .from(personalMemory)
    .where(and(ownedBy(owner), ...filterConditions(filter)))
    .orderBy(desc(personalMemory.pinned), desc(personalMemory.updatedAt), desc(personalMemory.id))
    .limit(Math.min(limit, PERSONAL_MEMORY_LIST_LIMIT + 1))
    .offset(offset)
}

/** The person's note with this `content_key` (`personalContentKey`), the column of the unique index (0232). */
export async function findPersonalMemoryByContentKey(
  owner: PersonalMemoryOwner,
  contentKey: string
): Promise<PersonalMemoryItem | null> {
  const [row] = await getDb()
    .select()
    .from(personalMemory)
    .where(and(ownedBy(owner), eq(personalMemory.contentKey, contentKey)))
    .limit(1)
  return row ?? null
}

export async function insertPersonalMemory(values: NewPersonalMemoryItem): Promise<PersonalMemoryItem> {
  const [row] = await getDb().insert(personalMemory).values(values).returning()
  return row
}

/** Mark a note the agent restated as current again, without changing what it says. */
export async function touchPersonalMemory(owner: PersonalMemoryOwner, id: string): Promise<PersonalMemoryItem | null> {
  const [row] = await getDb()
    .update(personalMemory)
    .set({ updatedAt: new Date() })
    .where(and(eq(personalMemory.id, id), ownedBy(owner)))
    .returning()
  return row ?? null
}

export async function updatePersonalMemory(
  owner: PersonalMemoryOwner,
  id: string,
  patch: Partial<Pick<PersonalMemoryItem, 'kind' | 'content' | 'contentKey' | 'pinned' | 'topic'>>
): Promise<PersonalMemoryItem | null> {
  const [row] = await getDb()
    .update(personalMemory)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(personalMemory.id, id), ownedBy(owner)))
    .returning()
  return row ?? null
}

export async function deletePersonalMemory(owner: PersonalMemoryOwner, id: string): Promise<boolean> {
  const deleted = await getDb()
    .delete(personalMemory)
    .where(and(eq(personalMemory.id, id), ownedBy(owner)))
    .returning({ id: personalMemory.id })
  return deleted.length > 0
}

/** The topic of every note of the person, null for a note with none: what the topics list counts. */
export async function selectPersonalTopics(owner: PersonalMemoryOwner): Promise<{ topic: string | null }[]> {
  return getDb().select({ topic: personalMemory.topic }).from(personalMemory).where(ownedBy(owner))
}

/**
 * Every note of the person on topic `from` (null: no topic) moves to `to`
 * (null: no topic). One statement; answers how many notes moved. The topic is
 * not in what `content_key` keys, so no unique index is at stake. The
 * timestamps stay: a rename files notes, it does not make them newer.
 */
export async function movePersonalTopic(
  owner: PersonalMemoryOwner,
  from: string | null,
  to: string | null
): Promise<number> {
  const moved = await getDb()
    .update(personalMemory)
    .set({ topic: to })
    .where(and(ownedBy(owner), sql`${personalMemory.topic} is not distinct from ${from}`))
    .returning({ id: personalMemory.id })
  return moved.length
}

/** Removes every note of the person on topic `topic`, for good; answers how many went. */
export async function deletePersonalTopic(owner: PersonalMemoryOwner, topic: string): Promise<number> {
  const deleted = await getDb()
    .delete(personalMemory)
    .where(and(ownedBy(owner), eq(personalMemory.topic, topic)))
    .returning({ id: personalMemory.id })
  return deleted.length
}

/** Every note of one person in one organization: what leaving the office, or an erasure request, removes. */
export async function deleteAllPersonalMemory(owner: PersonalMemoryOwner): Promise<number> {
  const deleted = await getDb().delete(personalMemory).where(ownedBy(owner)).returning({ id: personalMemory.id })
  return deleted.length
}
