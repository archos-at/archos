import 'server-only'
import { and, asc, desc, eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { curatedSkillActivations, type CuratedSkillActivation } from '@/lib/db/schema/curated-skill-activations'
import { skills, type NewSkill, type Skill } from '@/lib/db/schema/jobs'

export const SKILLS_LIST_LIMIT = 100

export async function insertSkill(values: NewSkill): Promise<Skill> {
  const db = getDb()
  const [row] = await db.insert(skills).values(values).returning()
  return row
}

export async function listSkillsInOrg(
  organizationId: string,
  limit = SKILLS_LIST_LIMIT,
): Promise<Skill[]> {
  const db = getDb()
  return db
    .select()
    .from(skills)
    .where(eq(skills.organizationId, organizationId))
    .orderBy(desc(skills.createdAt))
    .limit(limit)
}

export async function findSkill(skillId: string, organizationId: string): Promise<Skill | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.id, skillId), eq(skills.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

export async function findSkillByName(
  name: string,
  organizationId: string,
): Promise<Skill | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(skills)
    .where(and(eq(skills.name, name), eq(skills.organizationId, organizationId)))
    .limit(1)
  return row ?? null
}

export type SkillUpdate = Partial<
  Pick<
    Skill,
    | 'name'
    | 'description'
    | 'body'
    | 'metadata'
    | 'enabled'
    | 'categoryId'
    | 'updatedAt'
  >
>

export async function updateSkill(
  skillId: string,
  organizationId: string,
  patch: SkillUpdate,
): Promise<Skill | null> {
  const db = getDb()
  const [row] = await db
    .update(skills)
    .set(patch)
    .where(and(eq(skills.id, skillId), eq(skills.organizationId, organizationId)))
    .returning()
  return row ?? null
}

export async function deleteSkill(skillId: string, organizationId: string): Promise<boolean> {
  const db = getDb()
  const deleted = await db
    .delete(skills)
    .where(and(eq(skills.id, skillId), eq(skills.organizationId, organizationId)))
    .returning({ id: skills.id })
  return deleted.length > 0
}

export const ACTIVATIONS_LIST_LIMIT = 200

export async function listCuratedSkillActivations(
  organizationId: string,
  limit = ACTIVATIONS_LIST_LIMIT,
): Promise<CuratedSkillActivation[]> {
  const db = getDb()
  return db
    .select()
    .from(curatedSkillActivations)
    .where(eq(curatedSkillActivations.organizationId, organizationId))
    .orderBy(asc(curatedSkillActivations.skillName))
    .limit(limit)
}

export async function upsertCuratedSkillActivation(values: {
  organizationId: string
  skillName: string
  enabled: boolean
  updatedBy: string
  updatedByEmail?: string | null
}): Promise<CuratedSkillActivation> {
  const db = getDb()
  const [row] = await db
    .insert(curatedSkillActivations)
    .values({
      organizationId: values.organizationId,
      skillName: values.skillName,
      enabled: values.enabled,
      updatedBy: values.updatedBy,
      updatedByEmail: values.updatedByEmail ?? null,
    })
    .onConflictDoUpdate({
      target: [curatedSkillActivations.organizationId, curatedSkillActivations.skillName],
      set: {
        enabled: values.enabled,
        updatedBy: values.updatedBy,
        updatedByEmail: values.updatedByEmail ?? null,
        updatedAt: new Date(),
      },
    })
    .returning()
  return row
}
