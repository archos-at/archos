import 'server-only'
import { and, asc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { platformSkills, type NewPlatformSkillRow, type PlatformSkillRow } from '@/lib/db/schema/platform-skills'

export const PLATFORM_SKILLS_LIST_LIMIT = 200

export async function listPlatformSkillRows(
  limit = PLATFORM_SKILLS_LIST_LIMIT,
): Promise<PlatformSkillRow[]> {
  const db = getDb()
  return db.select().from(platformSkills).orderBy(asc(platformSkills.name)).limit(limit)
}

export async function listPublishedOfferRows(
  limit = PLATFORM_SKILLS_LIST_LIMIT,
): Promise<PlatformSkillRow[]> {
  const db = getDb()
  return db
    .select()
    .from(platformSkills)
    .where(and(eq(platformSkills.published, true), eq(platformSkills.delivery, 'offer')))
    .orderBy(asc(platformSkills.name))
    .limit(limit)
}

export async function findPlatformSkillRow(skillId: string): Promise<PlatformSkillRow | null> {
  const db = getDb()
  const [row] = await db.select().from(platformSkills).where(eq(platformSkills.id, skillId)).limit(1)
  return row ?? null
}

export async function findPlatformSkillRowByName(name: string): Promise<PlatformSkillRow | null> {
  const db = getDb()
  const [row] = await db.select().from(platformSkills).where(eq(platformSkills.name, name)).limit(1)
  return row ?? null
}

export async function insertPlatformSkillRow(
  values: NewPlatformSkillRow,
): Promise<PlatformSkillRow> {
  const db = getDb()
  const [row] = await db.insert(platformSkills).values(values).returning()
  return row
}

export type PlatformSkillUpdate = Partial<
  Pick<
    PlatformSkillRow,
    'name' | 'description' | 'body' | 'metadata' | 'published' | 'delivery' | 'categoryId' | 'updatedAt'
  >
>

export async function updatePlatformSkillRow(
  skillId: string,
  patch: PlatformSkillUpdate,
): Promise<PlatformSkillRow | null> {
  const db = getDb()
  const [row] = await db
    .update(platformSkills)
    .set(patch)
    .where(eq(platformSkills.id, skillId))
    .returning()
  return row ?? null
}

export async function deletePlatformSkillRow(skillId: string): Promise<boolean> {
  const db = getDb()
  const deleted = await db
    .delete(platformSkills)
    .where(eq(platformSkills.id, skillId))
    .returning({ id: platformSkills.id })
  return deleted.length > 0
}
