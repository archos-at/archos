import 'server-only'
import { and, desc, eq, isNull, sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { personalMemory, type NewPersonalMemoryItem, type PersonalMemoryItem } from '@/lib/db/schema/personal-memory'

export interface PersonalMemoryOwner {
  organizationId: string
  userId: string
}

export interface PersonalMemoryFilter {
  sourceConversationId?: string
  topic?: string | null
}

export const PERSONAL_MEMORY_LIST_LIMIT = 200

function ownedBy(owner: PersonalMemoryOwner) {
  return and(eq(personalMemory.organizationId, owner.organizationId), eq(personalMemory.userId, owner.userId))
}

function filterConditions(filter: PersonalMemoryFilter): SQL[] {
  const conditions: SQL[] = []
  if (filter.sourceConversationId) {
    conditions.push(eq(personalMemory.sourceConversationId, filter.sourceConversationId))
  }
  if (filter.topic === null) conditions.push(isNull(personalMemory.topic))
  else if (filter.topic !== undefined) conditions.push(eq(personalMemory.topic, filter.topic))
  return conditions
}

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

export async function touchPersonalMemory(
  owner: PersonalMemoryOwner,
  id: string,
  topic: string | null = null
): Promise<PersonalMemoryItem | null> {
  const [row] = await getDb()
    .update(personalMemory)
    .set({
      updatedAt: new Date(),
      ...(topic === null ? {} : { topic: sql<string>`coalesce(${personalMemory.topic}, ${topic})` }),
    })
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

export async function selectPersonalTopics(owner: PersonalMemoryOwner): Promise<{ topic: string | null }[]> {
  return getDb().select({ topic: personalMemory.topic }).from(personalMemory).where(ownedBy(owner))
}

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

export async function deletePersonalTopic(owner: PersonalMemoryOwner, topic: string): Promise<number> {
  const deleted = await getDb()
    .delete(personalMemory)
    .where(and(ownedBy(owner), eq(personalMemory.topic, topic)))
    .returning({ id: personalMemory.id })
  return deleted.length
}

export async function deleteAllPersonalMemory(owner: PersonalMemoryOwner): Promise<number> {
  const deleted = await getDb().delete(personalMemory).where(ownedBy(owner)).returning({ id: personalMemory.id })
  return deleted.length
}
