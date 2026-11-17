'use client'

import type { JSX } from 'react'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { ProjectSectionActions } from '@/components/shell/project-section-frame'
import { Button } from '@/components/ui/button'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import { listSkillCategories, type SkillCategoryListItem, type SkillListItem } from '@/adapters/api/skills-client'
import { SkillEditorDialog } from './skill-editor-dialog'
import { SkillToolbox } from './skill-toolbox'

interface SkillsPanelProps {
  canManageOrgSkills: boolean
}

export function SkillsPanel({ canManageOrgSkills }: SkillsPanelProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editSkill, setEditSkill] = useState<SkillListItem | null>(null)
  const [editorKey, setEditorKey] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)
  const [categories, setCategories] = useState<SkillCategoryListItem[]>([])
  const [categoryRefreshKey, setShelfRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    listSkillCategories()
      .then((shelves) => {
        if (!cancelled) setCategories(shelves)
      })
      .catch(() => {
        // The picker degrades to unsorted-only; the toolbox list is the
      })
    return () => {
      cancelled = true
    }
  }, [categoryRefreshKey])

  const openSkillEditor = (skill: SkillListItem | null) => {
    setEditSkill(skill)
    setEditorKey((key) => key + 1)
    setEditorOpen(true)
  }

  const refreshAfterSave = () => {
    setEditorOpen(false)
    setReloadKey((key) => key + 1)
    setShelfRefreshKey((key) => key + 1)
  }

  return (
    <div className="listing-container px-4 pb-10 pt-6 md:px-8" /* the section's content container: the header's left edge */>
      {canManageOrgSkills && (
        <ProjectSectionActions>
          <Button size="sm" className="shrink-0" onClick={() => openSkillEditor(null)}>
            <Plus className="size-4" aria-hidden />
            {t('toolbox.newSkill')}
          </Button>
        </ProjectSectionActions>
      )}
      <SkillToolbox
        canManage={canManageOrgSkills}
        onEdit={openSkillEditor}
        reloadKey={reloadKey}
        onCategoriesChanged={() => setShelfRefreshKey((key) => key + 1)}
      />
      <SkillEditorDialog
        key={editorKey}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        skill={editSkill}
        categories={categories}
        onSaved={refreshAfterSave}
      />
    </div>
  )
}
