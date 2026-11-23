import type { CreateSkillInput } from '@/adapters/api/skills-client'

export interface SkillPersistence {
  save: (input: CreateSkillInput & { categoryId?: string | null }, enabled: boolean) => Promise<void>
  remove?: () => Promise<void>
  switchLabels?: { label: string; hint: string }
  titles?: { create: string; edit: string; createSubtitle: string; editSubtitle: string }
  successMessage?: { create: string; edit: string }
  deleteCopy?: { title: string; description: string; confirm: string }
}
