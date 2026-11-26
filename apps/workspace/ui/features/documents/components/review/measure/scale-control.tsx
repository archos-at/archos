'use client'

import { useEffect, useRef, useState, type FormEvent, type JSX } from 'react'
import { createPortal } from 'react-dom'
import { Lock, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FactLine } from '@/components/ui/fact-line'
import { ToolbarIconButton, ToolbarTextButton } from '@/components/ui/floating-toolbar'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { QuantityInput } from '@/components/ui/quantity-input'
import { ROW_GLYPH_PRESS, ROW_HAIRLINE } from '@/components/ui/row-hairline'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { CalibrationView } from '@/lib/drawing-calibrations/wire'
import { CLAUSE_JOIN, formatMetres } from '@/lib/format'
import { formatScaleRatio } from '../../../lib/tape-format'
import { cn } from '@/lib/utils'
import { useCoarsePointer } from '../../../hooks/use-coarse-pointer'
import type { ReviewCalibration } from '../../../hooks/use-review-calibration'
import type { CalibrationStep } from '../../../lib/calibration-draft'
import { LENGTH_FIELD, ReviewForm, useRegionWords, useReviewAnchor } from './scale-review'

const STEP_NUMBER: Record<Exclude<CalibrationStep, 'review'>, number> = {
  firstPoint: 1,
  secondPoint: 1,
  length: 2,
  region: 3,
}

function CalibrationRow({
  entry,
  calibration,
}: {
  entry: CalibrationView
  calibration: ReviewCalibration
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const words = useRegionWords(calibration)
  const ratio = calibration.ratioOf(entry)
  const who =
    entry.createdBy === calibration.me
      ? t('review.measure.scale.you')
      : calibration.nameOf(entry.createdBy)
  const what = [formatMetres(entry.lengthM, locale), words(entry)].join(CLAUSE_JOIN)
  return (
    <li
      data-testid={`calibration-row-${entry.id}`}
      data-highlighted={calibration.hoveredId === entry.id || undefined}
      className={cn(
        'group/row flex min-h-[4.5rem] items-center gap-3 py-2 [--row-end:0px] [--row-text:0px]',
        ROW_HAIRLINE
      )}
      onPointerEnter={(event) => event.pointerType !== 'touch' && calibration.hover(entry.id)}
      onPointerLeave={(event) => event.pointerType !== 'touch' && calibration.hover(null)}
      onClick={() => calibration.hover(entry.id)}
      onFocus={() => calibration.hover(entry.id)}
      onBlur={() => calibration.hover(null)}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-name tabular-nums" data-testid="calibration-row-ratio">
          {ratio ?? '–'}
        </span>
        <span
          className="text-muted-foreground text-meta text-pretty"
          data-testid="calibration-row-where"
        >
          {what}
        </span>
        <span className="text-muted-foreground text-meta truncate">
          {who && `${who}${CLAUSE_JOIN}`}
          <TimeAgo date={entry.createdAt} locale={locale} />
        </span>
      </span>
      {calibration.canCalibrate && (
        <Button
          variant="secondary"
          size="sm"
          className={ROW_GLYPH_PRESS}
          aria-label={
            ratio
              ? t('review.measure.scale.removeNamed', { ratio })
              : t('review.measure.scale.remove')
          }
          data-testid="calibration-remove"
          onClick={() => void calibration.withdraw(entry)}
        >
          <Trash2 className="size-3.5" aria-hidden />
          <span className="sr-only pointer-fine:group-focus-within/row:not-sr-only pointer-fine:group-hover/row:not-sr-only">
            {t('review.measure.scale.remove')}
          </span>
        </Button>
      )}
    </li>
  )
}

function CancelPress({
  calibration,
  className,
}: {
  calibration: ReviewCalibration
  className?: string
}): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <ToolbarIconButton
      aria-label={t('review.measure.scale.steps.cancel')}
      title={t('review.measure.scale.steps.cancel')}
      data-testid="calibration-cancel"
      className={className}
      onClick={calibration.cancel}
    >
      <X aria-hidden />
    </ToolbarIconButton>
  )
}

type Typing = { value: number | null; setValue: (value: number | null) => void }

function LengthStep({
  calibration,
  typing,
}: {
  calibration: ReviewCalibration
  typing: Typing
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { value, setValue } = typing
  const typed = useRef(value)
  const field = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    field.current?.querySelector('input')?.focus()
  }, [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (typed.current !== null) calibration.setLength(typed.current)
  }
  return (
    <form
      className="flex items-center gap-2"
      data-testid="calibration-length-step"
      onSubmit={submit}
    >
      <span ref={field}>
        <QuantityInput
          value={value}
          onValueChange={(next) => {
            typed.current = next
            setValue(next)
          }}
          unit={t('review.measure.scale.form.unit')}
          label={t('review.measure.scale.form.lengthLabel')}
          positive
          min={0}
          max={100_000}
          step={0.01}
          settleMs={150}
          inputClassName={LENGTH_FIELD}
          invalidMessage={() => t('review.measure.scale.form.lengthInvalid')}
        />
      </span>
      <Button
        type="submit"
        size="sm"
        disabled={value === null}
        data-testid="calibration-length-next"
      >
        {t('review.measure.scale.steps.next')}
      </Button>
    </form>
  )
}

function StepBar({
  calibration,
  step,
}: {
  calibration: ReviewCalibration
  step: Exclude<CalibrationStep, 'review'>
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const touch = useCoarsePointer()
  const [value, setValue] = useState<number | null>(calibration.lengthM)
  const { draft } = calibration
  const gives =
    step === 'length' && value !== null && draft?.from && draft.to
      ? calibration.ratioOf({ page: draft.page, from: draft.from, to: draft.to, lengthM: value })
      : null
  return (
    <div
      role="group"
      aria-label={t('review.measure.scale.steps.label')}
      data-testid="calibration-steps"
      data-step={step}
      className="flex flex-wrap items-center gap-x-3 gap-y-2"
    >
      <p className="flex min-w-0 flex-1 basis-56 flex-col">
        <span className="text-muted-foreground text-meta tabular-nums">
          {t('review.measure.scale.steps.count', { step: STEP_NUMBER[step] })}
          {gives && (
            <span data-testid="calibration-length-gives">
              {CLAUSE_JOIN}
              {t('review.measure.scale.steps.gives', { ratio: gives })}
            </span>
          )}
        </span>
        <span className="text-sm" aria-live="polite" data-testid="calibration-next">
          {t(`review.measure.scale.${touch ? 'nextTouch' : 'next'}.${step}`)}
        </span>
      </p>
      {step !== 'firstPoint' && (
        <span className="order-2 ml-auto flex items-center gap-1.5 pointer-coarse:basis-full pointer-coarse:justify-end">
          {step === 'length' && (
            <LengthStep calibration={calibration} typing={{ value, setValue }} />
          )}
          {step === 'region' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="calibration-whole-page"
              onClick={calibration.wholePage}
            >
              {t('review.measure.scale.steps.wholePage')}
            </Button>
          )}
          {step === 'region' && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="calibration-whole-document"
              onClick={calibration.wholeDocument}
            >
              {t('review.measure.scale.steps.wholeDocument')}
            </Button>
          )}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="calibration-back"
            onClick={calibration.back}
          >
            {t('review.measure.scale.steps.back')}
          </Button>
        </span>
      )}
      <CancelPress
        calibration={calibration}
        className="order-3 self-center pointer-coarse:order-1 pointer-coarse:self-start"
      />
    </div>
  )
}

function useEscapeStepsBack(calibration: ReviewCalibration): void {
  const { setting, back } = calibration
  useEffect(() => {
    if (!setting) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setting, back])
}

export function ScaleControl({
  calibration,
  page,
  estimatedRatio = null,
}: {
  calibration: ReviewCalibration
  page: number
  estimatedRatio?: number | null
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const touch = useCoarsePointer()
  useEscapeStepsBack(calibration)
  const anchor = useReviewAnchor(calibration.draftLayer, calibration.step === 'review' && !touch)
  if (!calibration.shown) {
    return calibration.loading ? (
      <ToolbarTextButton disabled aria-busy data-testid="scale-button">
        {t('review.measure.scale.button.loading')}
      </ToolbarTextButton>
    ) : null
  }
  const shownPage = calibration.draft?.from ? calibration.draft.page : page
  const entries = calibration.onPage(shownPage)
  const { step } = calibration
  const picking = step !== null && step !== 'review' ? step : null
  const docked = touch && step !== null
  return (
    <>
      <Popover
        open={calibration.open && !docked}
        onOpenChange={(next) => {
          if (next || !calibration.setting) calibration.setOpen(next)
        }}
        modal={false}
      >
        <PopoverTrigger asChild>
          <ToolbarTextButton data-testid="scale-button">
            {estimatedRatio !== null && calibration.onPage(page).length === 0
              ? t('review.measure.scale.button.estimated', {
                  ratio: `1:${formatScaleRatio(estimatedRatio, locale)}`,
                })
              : calibration.labelFor(page)}
          </ToolbarTextButton>
        </PopoverTrigger>
        {anchor.shown && <PopoverAnchor virtualRef={anchor.virtualRef} />}
        <PopoverContent
          side={anchor.shown ? anchor.side : 'bottom'}
          align={anchor.shown && anchor.side !== 'bottom' ? 'start' : 'center'}
          sideOffset={anchor.shown ? 16 : 8}
          updatePositionStrategy={anchor.shown ? 'always' : 'optimized'}
          className={
            picking
              ? 'w-auto max-w-[min(44rem,var(--radix-popover-content-available-width))] p-2 pl-3'
              : 'flex w-80 flex-col gap-3'
          }
          data-testid="scale-popover"
          aria-label={t('review.measure.scale.title', { page: shownPage })}
          onInteractOutside={(event) => {
            const target = event.target
            if (
              calibration.setting &&
              target instanceof Element &&
              target.closest('[data-calibration-capture]')
            ) {
              event.preventDefault()
            }
          }}
          onEscapeKeyDown={(event) => {
            if (!calibration.setting) return
            event.preventDefault()
            calibration.back()
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          {picking ? (
            <StepBar calibration={calibration} step={picking} />
          ) : (
            <>
              <span className="flex items-center justify-between gap-2">
                <h2 className="text-name">
                  {t('review.measure.scale.title', { page: shownPage })}
                </h2>
                {calibration.setting && <CancelPress calibration={calibration} />}
              </span>
              {calibration.setting ? (
                <ReviewForm calibration={calibration} />
              ) : (
                <>
                  {entries.length > 0 ? (
                    <ul
                      aria-label={t('review.measure.scale.listLabel', { page: shownPage })}
                      data-testid="calibration-list"
                      className="-my-2 flex flex-col"
                    >
                      {entries.map((entry) => (
                        <CalibrationRow key={entry.id} entry={entry} calibration={calibration} />
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted-foreground text-meta" data-testid="calibration-none">
                      {t('review.measure.scale.none')}
                    </p>
                  )}
                  {calibration.canCalibrate ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="self-start"
                      data-testid="calibration-start"
                      onClick={() => calibration.beginSetting(page)}
                    >
                      {t('review.measure.scale.set')}
                    </Button>
                  ) : (
                    <FactLine icon={Lock} testId="calibration-not-allowed">
                      {t('review.measure.scale.notAllowed')}
                    </FactLine>
                  )}
                </>
              )}
            </>
          )}
        </PopoverContent>
      </Popover>
      {docked &&
        createPortal(
          <div
            data-testid="calibration-step-dock"
            className="bg-popover text-popover-foreground rounded-overlay fixed inset-x-2 bottom-[max(0.5rem,env(safe-area-inset-bottom))] z-50 px-3 py-2 shadow-md"
          >
            {picking ? (
              <StepBar calibration={calibration} step={picking} />
            ) : (
              <span className="flex flex-col gap-1">
                <span className="flex items-center justify-between gap-2">
                  <h2 className="text-name">
                    {t('review.measure.scale.title', { page: shownPage })}
                  </h2>
                  <CancelPress calibration={calibration} />
                </span>
                <ReviewForm calibration={calibration} compact />
              </span>
            )}
          </div>,
          document.body
        )}
      <span role="status" className="sr-only" data-testid="calibration-said">
        {calibration.said}
      </span>
    </>
  )
}
