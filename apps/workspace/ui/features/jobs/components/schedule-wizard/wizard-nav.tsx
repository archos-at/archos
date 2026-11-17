'use client'

import type { JSX } from 'react'
import { ArrowLeft, ArrowRight, Check, Play } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { useTranslations } from '@/i18n'
import { jobsCopy } from '@/i18n/namespaces/jobs'
import { cn } from '@/lib/utils'

import type { StepKey } from '../../lib/wizard-state'

export function WizardNav({
  step,
  stepIndex,
  blocked,
  isSubmitting,
  canSubmit,
  onBack,
  onNext,
  editing,
  onRunAfterSave,
}: {
  step: StepKey
  stepIndex: number
  blocked: boolean
  isSubmitting: boolean
  canSubmit: boolean
  onBack: () => void
  onNext: () => void
  editing: boolean
  onRunAfterSave: () => void
}): JSX.Element {
  const t = useTranslations(jobsCopy)
  const last = step === 'review'

  return (
    <div
      data-testid="wizard-nav"
      className={cn(
        'border-border bg-background sticky bottom-0 z-10 flex items-center justify-between gap-2 border-t pb-3 pt-3',
        last && 'max-sm:flex-col-reverse max-sm:items-stretch',
      )}
    >
      <Button
        type="button"
        variant="ghost"
        onClick={onBack}
        className={cn(last && 'max-sm:justify-center')}
      >
        <ArrowLeft className="size-4" aria-hidden />
        {stepIndex === 0 ? t('builder.cancel') : t('builder.back')}
      </Button>
      {last ? (
        <div className="flex items-center gap-2 max-sm:flex-col-reverse max-sm:items-stretch">
          {/* Secondary, and never the busy one: exactly one control shows the
              spinner so a reader is never asked which of two buttons is the
              one that is working. Both are disabled while it saves. */}
          <Button
            type="submit"
            variant="secondary"
            disabled={!canSubmit || isSubmitting}
            onClick={onRunAfterSave}
            data-testid="wizard-save-and-run"
          >
            <Play className="size-4" aria-hidden />
            {editing ? t('builder.saveAndRun') : t('builder.createAndRun')}
          </Button>
          <Button type="submit" disabled={!canSubmit || isSubmitting} aria-busy={isSubmitting}>
            {/* Both labels stay mounted so the button width does not jump when
                "Speichern" becomes "Wird gespeichert…". */}
            <span className="inline-grid justify-items-start">
              <span
                className={cn(
                  'col-start-1 row-start-1 inline-flex items-center gap-2',
                  isSubmitting && 'invisible',
                )}
                aria-hidden={isSubmitting}
              >
                <Check className="size-4" aria-hidden />
                {editing ? t('builder.save') : t('builder.create')}
              </span>
              <span
                className={cn(
                  'col-start-1 row-start-1 inline-flex items-center gap-2',
                  !isSubmitting && 'invisible',
                )}
                aria-hidden={!isSubmitting}
              >
                <Spinner size="sm" aria-hidden />
                {t('builder.saving')}
              </span>
            </span>
          </Button>
        </div>
      ) : (
        <Button type="button" onClick={onNext} disabled={blocked} data-testid="wizard-next">
          {t('builder.next')}
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}
