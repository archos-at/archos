'use client'

import type { JSX, ReactNode } from 'react'
import { BusyButton } from '@/components/ui/busy-button'
import { DesktopLayoutOnly } from '@/components/ui/layout-only'
import { useIsMobileOnceKnown } from '@/hooks/use-is-mobile-once-known'
import { useTranslations } from '@/i18n'
import { intakeQuestionsStepCopy } from '@/i18n/namespaces/intake-questions-step'
import { ASIDE_ACTION_CLASS, PRIMARY_ACTION_CLASS, StepFooter, type StepProgress } from '../setup-frame'

export interface QuestionPosition {
  index: number
  total: number
  why: string
}

export interface RoundFooter {
  progress: StepProgress
  desk: ReactNode
}

export interface QuestionActions {
  canDecide: boolean
  busy: boolean
  canSubmit: boolean
  submitting: boolean
  onSubmit: () => void
  skipLabel: string
  skipBusyLabel: string
  skipAria: string
  skipping: boolean
  onSkip: () => void
}

export function QuestionShell({
  testId,
  position,
  title,
  description,
  meta,
  children,
  actions,
  handIn,
  footer,
  after,
}: {
  testId: string
  position: QuestionPosition
  title: string
  description?: string
  meta?: string
  children: ReactNode
  actions: QuestionActions
  handIn?: ReactNode
  footer: RoundFooter
  after?: ReactNode
}): JSX.Element {
  const t = useTranslations(intakeQuestionsStepCopy)
  const mobile = useIsMobileOnceKnown()
  const submit = (
    <BusyButton
      type="button"
      className={PRIMARY_ACTION_CLASS}
      disabled={!actions.canDecide || !actions.canSubmit}
      busy={actions.submitting}
      blocked={actions.busy}
      busyLabel={t('card.submitting')}
      onClick={actions.onSubmit}
    >
      {t('card.submit')}
    </BusyButton>
  )
  const skip = (className: string): JSX.Element => (
    <BusyButton
      type="button"
      variant="ghost"
      className={className}
      disabled={!actions.canDecide}
      busy={actions.skipping}
      blocked={actions.busy}
      busyLabel={actions.skipBusyLabel}
      aria-label={actions.skipAria}
      onClick={actions.onSkip}
    >
      {actions.skipLabel}
    </BusyButton>
  )

  return (
    <section
      aria-labelledby={`${testId}-title`}
      data-testid={testId}
      className="md:bg-card md:border-border w-full min-w-0 md:max-w-[640px] md:self-start md:rounded-[12px] md:border md:px-9 md:py-8"
    >
      <p className="text-muted-foreground text-[13px] tabular-nums">
        <span className="hidden md:inline">
          {t('card.position', { index: position.index, total: position.total })} · {position.why}
        </span>
        <span className="block first-letter:uppercase md:hidden">{position.why}</span>
      </p>
      <h2
        id={`${testId}-title`}
        className="mt-2 text-[22px] leading-[1.3] font-medium break-words hyphens-auto md:mt-2.5"
      >
        {title}
      </h2>
      {description && (
        <p className="text-muted-foreground mt-3 text-[15px] leading-normal hyphens-auto md:mt-2.5 md:text-sm">
          {description}
        </p>
      )}
      {meta && <p className="text-muted-foreground mt-1.5 text-xs">{meta}</p>}

      <div className="mt-6">{children}</div>

      <DesktopLayoutOnly>
        <div className="mt-7 flex items-center gap-2.5" data-testid="question-actions">
          {submit}
          {skip('text-muted-foreground h-[42px] px-3.5 font-normal')}
        </div>
      </DesktopLayoutOnly>

      {handIn && <div className="mt-6 md:mt-7">{handIn}</div>}
      {after && <div className="mt-6 flex flex-col items-start gap-1 md:hidden">{after}</div>}

      {mobile === true && <StepFooter primary={submit} aside={skip(ASIDE_ACTION_CLASS)} progress={footer.progress} />}
      {mobile === false && <StepFooter primary={footer.desk} progress={footer.progress} />}
    </section>
  )
}
