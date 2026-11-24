import type { JSX } from 'react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import type { SkillPersistence } from '../../lib/skill-persistence'

interface SkillEditorHeaderProps {
  isEdit: boolean
  persistence?: SkillPersistence
}

export function SkillEditorHeader({ isEdit, persistence }: SkillEditorHeaderProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  return (
    <DialogHeader className="border-border shrink-0 border-b px-6 py-5 pr-14">
      <DialogTitle>
        {isEdit
          ? (persistence?.titles?.edit ?? t('editor.editTitle'))
          : (persistence?.titles?.create ?? t('editor.createTitle'))}
      </DialogTitle>
      <DialogDescription>
        {isEdit
          ? (persistence?.titles?.editSubtitle ?? t('editor.editSubtitle'))
          : (persistence?.titles?.createSubtitle ?? t('editor.createSubtitle'))}
      </DialogDescription>
    </DialogHeader>
  )
}
