import type { JSX, ReactNode } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { useTranslations } from '@/i18n'
import { skillsCopy } from '@/i18n/namespaces/skills'
import type { StepKey } from '../../lib/skill-editor-steps'

interface SkillEditorFooterProps {
  formError: string | null
  step: StepKey
  stepIndex: number
  canDelete: boolean
  reviewChecked: boolean
  saveButton: ReactNode
  onBack: () => void
  onNext: () => void
  onDelete: () => void
}

export function SkillEditorFooter({
  formError,
  step,
  stepIndex,
  canDelete,
  reviewChecked,
  saveButton,
  onBack,
  onNext,
  onDelete,
}: SkillEditorFooterProps): JSX.Element {
  const t = useTranslations(skillsCopy)
  return (
    <div className="border-border bg-popover shrink-0 border-t px-6 py-4">
      {formError && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}
      {/* Back / Weiter, and Speichern only on the last step — the task
          builder's nav, because this is the same kind of form.
          „Weiter" never validates: a stepped form that refuses to move
          on is one people answer defensively, and every field is
          validated on the save anyway. */}
      <DialogFooter className="sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          onClick={onBack}
          data-testid="skill-back"
        >
          {stepIndex === 0 ? t('editor.cancel') : t('editor.steps.back')}
        </Button>
        {step !== 'check' ? (
          <Button type="button" onClick={onNext} data-testid="skill-next">
            {t('editor.steps.next')}
          </Button>
        ) : (
          <div className="flex items-center gap-2">
            {canDelete && (
              <Button
                type="button"
                variant="secondary"
                className="text-destructive hover:text-destructive"
                onClick={onDelete}
              >
                {t('actions.delete')}
              </Button>
            )}
            {saveButton}
          </div>
        )}
      </DialogFooter>
      {step === 'check' && !reviewChecked && (
        <p
          id="skill-review-required"
          className="text-muted-foreground mt-2 text-right text-xs"
          data-testid="skill-review-required"
        >
          {t('editor.review.required')}
        </p>
      )}
    </div>
  )
}
