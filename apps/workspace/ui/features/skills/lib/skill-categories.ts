import type { SkillCategoryListItem, SkillListItem } from '@/adapters/api/skills-client'

export interface CategoryGroup {
  category: SkillCategoryListItem | null
  skills: SkillListItem[]
}

export function groupSkillsByCategory(
  skills: readonly SkillListItem[],
  categories: readonly SkillCategoryListItem[],
): CategoryGroup[] {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const groups = new Map<string | null, SkillListItem[]>()
  for (const skill of skills) {
    const key = skill.categoryId && byId.has(skill.categoryId) ? skill.categoryId : null
    const group = groups.get(key)
    if (group) group.push(skill)
    else groups.set(key, [skill])
  }
  const ordered: CategoryGroup[] = []
  for (const category of categories) {
    const members = groups.get(category.id)
    if (members && members.length > 0) ordered.push({ category, skills: members })
  }
  const unsorted = groups.get(null)
  if (unsorted && unsorted.length > 0) ordered.push({ category: null, skills: unsorted })
  return ordered
}

export function matchesSkillQuery(skill: SkillListItem, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (
    skill.name.toLowerCase().includes(needle) ||
    skill.description.toLowerCase().includes(needle)
  )
}
