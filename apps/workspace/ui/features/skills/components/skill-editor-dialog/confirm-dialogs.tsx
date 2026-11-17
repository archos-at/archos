import type { Dispatch, JSX, SetStateAction } from 'react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import type { SkillPersistence } from '../../lib/skill-persistence'

interface SkillEditorConfirmDialogsProps {
  discardOpen: boolean
  setDiscardOpen: Dispatch<SetStateAction<boolean>>
  onDiscard: () => void
  confirmOpen: boolean
  setConfirmOpen: Dispatch<SetStateAction<boolean>>
  deleting: boolean
  skillName: string
  persistence?: SkillPersistence
  onConfirmDelete: () => void
}

export function SkillEditorConfirmDialogs({
  discardOpen,
  setDiscardOpen,
  onDiscard,
  confirmOpen,
  setConfirmOpen,
  deleting,
  skillName,
  persistence,
  onConfirmDelete,
}: SkillEditorConfirmDialogsProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  return (
    <>
      {/* Closing with unsaved work. Stacked over the editor on purpose: the
          editor stays mounted and keeps every field while the question is open,
          so "Weiter bearbeiten" costs nothing. */}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        tone="warning"
        title={t('editor.discardTitle')}
        description={t('editor.discardBody')}
        confirmLabel={t('editor.discardConfirm')}
        cancelLabel={t('editor.discardKeep')}
        onConfirm={onDiscard}
      />

      {/* Edit-mode delete: removes the skill from the toolbox; schedules keep
          their saved snapshot, so they keep running unchanged. */}
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        tone="destructive"
        title={persistence?.deleteCopy?.title ?? t('editor.deleteTitle')}
        description={
          persistence?.deleteCopy?.description ??
          t('editor.deleteDescription', { name: skillName })
        }
        confirmLabel={persistence?.deleteCopy?.confirm ?? t('editor.deleteConfirm')}
        cancelLabel={t('editor.cancel')}
        pending={deleting}
        onConfirm={onConfirmDelete}
      />
    </>
  )
}
