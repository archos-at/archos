'use client'

import type { JSX } from 'react'
import { useMemo } from 'react'
import { SkillEditorDialog, type SkillPersistence } from '@/features/skills/components/skill-editor-dialog'
import { useTranslations } from '@/i18n'
import { platformCopy } from '@/i18n/namespaces/platform'
import {
  createPlatformSkill,
  deletePlatformSkill,
  updatePlatformSkill,
  type PlatformSkillItem,
  type SkillCategoryListItem,
  type SkillListItem,
} from '@/adapters/api/skills-client'

interface PlatformSkillEditorDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skill: PlatformSkillItem | null
  categories?: SkillCategoryListItem[]
  onSaved: () => void
}

function toEditorSkill(skill: PlatformSkillItem): SkillListItem {
  return {
    id: null,
    name: skill.name,
    description: skill.description,
    body: skill.body,
    metadata: skill.metadata,
    origin: 'platform',
    enabled: skill.published,
    clonedFrom: null,
    categoryId: skill.categoryId,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
  }
}

export function PlatformSkillEditorDialog({
  open,
  onOpenChange,
  skill,
  categories = [],
  onSaved,
}: PlatformSkillEditorDialogProps): JSX.Element {
  const t = useTranslations(platformCopy)

  const persistence = useMemo<SkillPersistence>(
    () => ({
      save: async (input, published) => {
        const base = {
          name: input.name,
          description: input.description,
          body: input.body,
          metadata: input.metadata,
          published,
        }
        if (skill) {
          await updatePlatformSkill(skill.id, { ...base, categoryId: input.categoryId ?? null })
        } else if (input.categoryId) {
          await createPlatformSkill({ ...base, categoryId: input.categoryId })
        } else {
          await createPlatformSkill(base)
        }
      },
      remove: skill ? async () => void (await deletePlatformSkill(skill.id)) : undefined,
      switchLabels: {
        label: t('skills.publishLabel'),
        hint: t('skills.publishHint'),
      },
      titles: {
        create: t('skills.createTitle'),
        edit: t('skills.editTitle'),
        createSubtitle: t('skills.createSubtitle'),
        editSubtitle: t('skills.editSubtitle'),
      },
      successMessage: {
        create: t('skills.createSuccess'),
        edit: t('skills.updateSuccess'),
      },
      deleteCopy: {
        title: t('skills.deleteTitle'),
        description: t('skills.deleteDescription', { name: skill?.name ?? '' }),
        confirm: t('skills.deleteConfirm'),
      },
    }),
    [skill, t],
  )

  return (
    <SkillEditorDialog
      open={open}
      onOpenChange={onOpenChange}
      skill={skill ? toEditorSkill(skill) : null}
      persistence={persistence}
      categories={categories}
      onSaved={onSaved}
    />
  )
}
