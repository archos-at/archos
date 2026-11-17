import 'server-only'
import { ConflictError, NotFoundError } from '@/lib/api/errors'
import type { PlatformSkillDelivery, PlatformSkillRow } from '@/lib/db/schema/platform-skills'
import * as repository from './platform-repository'
import * as categoryRepository from './skill-category-repository'
import { findPlatformSkill } from './platform-skills'
import type {
  CreateCategoryInput,
  CreatePlatformSkillInput,
  PatchCategoryInput,
  PatchPlatformSkillInput,
  SkillCategoryListItem,
} from './types'

export type PlatformSkillListItem = {
  id: string
  name: string
  description: string
  body: string
  metadata: Record<string, string>
  published: boolean
  delivery: PlatformSkillDelivery
  categoryId: string | null
  createdAt: Date
  updatedAt: Date
}

function toListItem(row: PlatformSkillRow): PlatformSkillListItem {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    body: row.body,
    metadata: { ...row.metadata },
    published: row.published,
    delivery: row.delivery,
    categoryId: row.categoryId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function toCategoryListItem(row: {
  id: string
  name: string
  description: string | null
  slug: string | null
  sortOrder: number
}): SkillCategoryListItem {
  return { id: row.id, name: row.name, description: row.description, slug: row.slug, sortOrder: row.sortOrder, scope: 'platform' }
}

async function assertPlatformSkillCategory(categoryId: string | null | undefined): Promise<string | null> {
  if (categoryId === undefined || categoryId === null) return null
  const category = await categoryRepository.findPlatformSkillCategory(categoryId)
  if (!category) throw new NotFoundError('Skill category not found.')
  return category.id
}

async function assertNameIsFree(name: string, exceptId?: string): Promise<void> {
  if (findPlatformSkill(name)) {
    throw new ConflictError(`"${name}" is the name of a built-in skill.`)
  }
  const existing = await repository.findPlatformSkillRowByName(name)
  if (existing && existing.id !== exceptId) {
    throw new ConflictError(`A curated skill named "${name}" already exists.`)
  }
}

export async function listPlatformSkills(): Promise<{ skills: PlatformSkillListItem[] }> {
  const rows = await repository.listPlatformSkillRows()
  return { skills: rows.map(toListItem) }
}

export async function createPlatformSkill(
  input: CreatePlatformSkillInput,
  author: { userId: string; email: string | null },
): Promise<{ skill: PlatformSkillListItem }> {
  await assertNameIsFree(input.name)
  const row = await repository.insertPlatformSkillRow({
    name: input.name,
    description: input.description,
    body: input.body,
    metadata: input.metadata ?? {},
    published: input.published ?? false,
    delivery: input.delivery ?? 'offer',
    categoryId: await assertPlatformSkillCategory(input.categoryId),
    createdBy: author.userId,
    createdByEmail: author.email,
  })
  return { skill: toListItem(row) }
}

export async function updatePlatformSkill(
  skillId: string,
  patch: PatchPlatformSkillInput,
): Promise<{ skill: PlatformSkillListItem }> {
  const existing = await repository.findPlatformSkillRow(skillId)
  if (!existing) throw new NotFoundError('Curated skill not found.')

  if (patch.name !== undefined && patch.name !== existing.name) {
    await assertNameIsFree(patch.name, skillId)
  }

  const { categoryId, ...rest } = patch
  const row = await repository.updatePlatformSkillRow(skillId, {
    ...rest,
    ...(categoryId !== undefined ? { categoryId: await assertPlatformSkillCategory(categoryId) } : {}),
    updatedAt: new Date(),
  })
  if (!row) throw new NotFoundError('Curated skill not found.')
  return { skill: toListItem(row) }
}

export async function deletePlatformSkill(skillId: string): Promise<{ deleted: true }> {
  const deleted = await repository.deletePlatformSkillRow(skillId)
  if (!deleted) throw new NotFoundError('Curated skill not found.')
  return { deleted: true }
}

export async function listPlatformSkillCategories(): Promise<{ categories: SkillCategoryListItem[] }> {
  const rows = await categoryRepository.listPlatformSkillCategories()
  return { categories: rows.map(toCategoryListItem) }
}

export async function createPlatformSkillCategory(
  input: CreateCategoryInput,
  author: { userId: string; email: string | null },
): Promise<{ category: SkillCategoryListItem }> {
  const existing = await categoryRepository.findPlatformSkillCategoryByName(input.name)
  if (existing) {
    throw new ConflictError(`A category named "${input.name}" already exists.`)
  }
  const visible = await categoryRepository.listPlatformSkillCategories(
    categoryRepository.CATEGORIES_LIST_LIMIT + 1,
  )
  if (visible.length >= categoryRepository.CATEGORIES_LIST_LIMIT) {
    throw new ConflictError(
      `Category limit reached (${categoryRepository.CATEGORIES_LIST_LIMIT}). Remove an unused category before adding another.`
    )
  }
  const row = await categoryRepository.insertCategory({
    organizationId: null,
    name: input.name,
    description: input.description ?? null,
    sortOrder: input.sortOrder ?? 0,
    createdBy: author.userId,
    createdByEmail: author.email,
  })
  return { category: toCategoryListItem(row) }
}

export async function updatePlatformSkillCategory(
  categoryId: string,
  patch: PatchCategoryInput,
): Promise<{ category: SkillCategoryListItem }> {
  const existing = await categoryRepository.findPlatformSkillCategory(categoryId)
  if (!existing) throw new NotFoundError('Skill category not found.')

  if (patch.name !== undefined && patch.name !== existing.name) {
    const other = await categoryRepository.findPlatformSkillCategoryByName(patch.name)
    if (other) {
      throw new ConflictError(`A category named "${patch.name}" already exists.`)
    }
  }
  const row = await categoryRepository.updateCategory(categoryId, {
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.description !== undefined ? { description: patch.description } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    updatedAt: new Date(),
  })
  if (!row) throw new NotFoundError('Skill category not found.')
  return { category: toCategoryListItem(row) }
}

export async function deletePlatformSkillCategory(categoryId: string): Promise<{ deleted: true }> {
  const existing = await categoryRepository.findPlatformSkillCategory(categoryId)
  if (!existing) throw new NotFoundError('Skill category not found.')
  await categoryRepository.deleteCategory(categoryId)
  return { deleted: true }
}
