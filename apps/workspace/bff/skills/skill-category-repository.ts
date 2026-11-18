import 'server-only'
import { and, asc, eq, isNull, or } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { skillCategories, type NewSkillCategoryRow, type SkillCategoryRow } from '@/lib/db/schema/skill-categories'

export const CATEGORIES_LIST_LIMIT = 100

export async function listCategoriesForOrg(
  organizationId: string,
  limit = CATEGORIES_LIST_LIMIT,
): Promise<SkillCategoryRow[]> {
  const [platform, own] = await Promise.all([
    listPlatformSkillCategories(limit),
    listOrgCategories(organizationId, limit),
  ])
  return [...platform, ...own]
}

export async function listOrgCategories(
  organizationId: string,
  limit = CATEGORIES_LIST_LIMIT,
): Promise<SkillCategoryRow[]> {
  const db = getDb()
  return db
    .select()
    .from(skillCategories)
    .where(eq(skillCategories.organizationId, organizationId))
    .orderBy(asc(skillCategories.sortOrder), asc(skillCategories.name))
    .limit(limit)
}

export async function listPlatformSkillCategories(
  limit = CATEGORIES_LIST_LIMIT,
): Promise<SkillCategoryRow[]> {
  const db = getDb()
  return db
    .select()
    .from(skillCategories)
    .where(isNull(skillCategories.organizationId))
    .orderBy(asc(skillCategories.sortOrder), asc(skillCategories.name))
    .limit(limit)
}

export async function findCategoryInScope(
  categoryId: string,
  organizationId: string,
): Promise<SkillCategoryRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(skillCategories)
    .where(
      and(
        eq(skillCategories.id, categoryId),
        or(isNull(skillCategories.organizationId), eq(skillCategories.organizationId, organizationId)),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function findPlatformSkillCategory(categoryId: string): Promise<SkillCategoryRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(skillCategories)
    .where(and(eq(skillCategories.id, categoryId), isNull(skillCategories.organizationId)))
    .limit(1)
  return row ?? null
}

export async function findOrgCategoryByName(
  name: string,
  organizationId: string,
): Promise<SkillCategoryRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(skillCategories)
    .where(
      and(eq(skillCategories.name, name), eq(skillCategories.organizationId, organizationId)),
    )
    .limit(1)
  return row ?? null
}

export async function findPlatformSkillCategoryByName(name: string): Promise<SkillCategoryRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(skillCategories)
    .where(and(eq(skillCategories.name, name), isNull(skillCategories.organizationId)))
    .limit(1)
  return row ?? null
}

export async function findOrgCategory(
  categoryId: string,
  organizationId: string,
): Promise<SkillCategoryRow | null> {
  const db = getDb()
  const [row] = await db
    .select()
    .from(skillCategories)
    .where(
      and(
        eq(skillCategories.id, categoryId),
        eq(skillCategories.organizationId, organizationId),
      ),
    )
    .limit(1)
  return row ?? null
}

export async function insertCategory(values: NewSkillCategoryRow): Promise<SkillCategoryRow> {
  const db = getDb()
  const [row] = await db.insert(skillCategories).values(values).returning()
  return row
}

export type CategoryUpdate = Partial<
  Pick<SkillCategoryRow, 'name' | 'description' | 'sortOrder' | 'updatedAt'>
>

export async function updateCategory(
  categoryId: string,
  patch: CategoryUpdate,
): Promise<SkillCategoryRow | null> {
  const db = getDb()
  const [row] = await db
    .update(skillCategories)
    .set(patch)
    .where(eq(skillCategories.id, categoryId))
    .returning()
  return row ?? null
}

export async function deleteCategory(categoryId: string): Promise<boolean> {
  const db = getDb()
  const deleted = await db
    .delete(skillCategories)
    .where(eq(skillCategories.id, categoryId))
    .returning({ id: skillCategories.id })
  return deleted.length > 0
}

export function orgCategoryValues(
  organizationId: string,
  values: Omit<NewSkillCategoryRow, 'organizationId'>,
): NewSkillCategoryRow {
  return { ...values, organizationId }
}
