'use client'

import { useId, type JSX } from 'react'
import { Lock, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { FactLine } from '@/components/ui/fact-line'
import { FactList, FactRow } from '@/components/ui/fact-list'
import { ToolbarIconButton, ToolbarTextButton } from '@/components/ui/floating-toolbar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { QuantityInput } from '@/components/ui/quantity-input'
import { ROW_GLYPH_PRESS, ROW_HAIRLINE } from '@/components/ui/row-hairline'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { CalibrationView } from '@/lib/drawing-calibrations/wire'
import { CLAUSE_JOIN, formatMetres } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useCoarsePointer } from '../../../hooks/use-coarse-pointer'
import type { ReviewCalibration } from '../../../hooks/use-review-calibration'
import { regionPlace } from '../../../lib/calibration-draft'

function CalibrationRow({ entry, calibration }: { entry: CalibrationView; calibration: ReviewCalibration }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const ratio = calibration.ratioOf(entry)
  const who = entry.createdBy === calibration.me ? t('review.measure.scale.you') : calibration.nameOf(entry.createdBy)
  const what = [formatMetres(entry.lengthM, locale), t(`review.measure.scale.where.${regionPlace(entry.region)}`)].join(CLAUSE_JOIN)
  return (
    <li
      data-testid={`calibration-row-${entry.id}`}
      className={cn('group/row flex min-h-[4.5rem] items-center gap-3 py-2 [--row-end:0px] [--row-text:0px]', ROW_HAIRLINE)}
      onPointerEnter={() => calibration.hover(entry.id)}
      onPointerLeave={() => calibration.hover(null)}
      onFocus={() => calibration.hover(entry.id)}
      onBlur={() => calibration.hover(null)}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-name tabular-nums" data-testid="calibration-row-ratio">
          {ratio ?? '–'}
        </span>
        <span className="text-muted-foreground text-meta truncate">{what}</span>
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
          aria-label={ratio ? t('review.measure.scale.removeNamed', { ratio }) : t('review.measure.scale.remove')}
          data-testid="calibration-remove"
          onClick={() => void calibration.withdraw(entry)}
        >
          <Trash2 className="size-3.5" aria-hidden />
          <span className="sr-only pointer-fine:group-hover/row:not-sr-only pointer-fine:group-focus-within/row:not-sr-only">
            {t('review.measure.scale.remove')}
          </span>
        </Button>
      )}
    </li>
  )
}

function SetForm({ calibration }: { calibration: ReviewCalibration }): JSX.Element {
  const t = useTranslations(filesCopy)
  const touch = useCoarsePointer()
  const nextId = useId()
  const refusalId = useId()
  const { draft, proposal, lengthM, saveFailure } = calibration
  const points = !draft?.from ? 'spanNone' : draft.to ? 'spanSet' : 'spanOne'
  const refusedBy =
    proposal.overlaps ??
    (saveFailure?.kind === 'overlaps' ? (calibration.calibrations.find((entry) => entry.id === saveFailure.overlapping) ?? null) : null)
  const refused = proposal.blocked === 'overlaps' || saveFailure?.kind === 'overlaps'
  const refusedRatio = refusedBy ? calibration.ratioOf(refusedBy) : null
  const region = !draft?.region
    ? t('review.measure.scale.form.regionMissing')
    : proposal.blocked === 'regionMisses'
      ? t('review.measure.scale.form.regionMisses')
      : t(`review.measure.scale.where.${regionPlace(draft.region)}`)
  const replacing = proposal.replaces ? calibration.ratioOf(proposal.replaces) : null
  const next = proposal.blocked && proposal.blocked !== 'overlaps' ? proposal.blocked : null
  return (
    <form data-testid="calibration-form" className="flex flex-col gap-3" onSubmit={(event) => event.preventDefault()}>
      <FactList className="gap-2">
        <FactRow
          label={t('review.measure.scale.form.span')}
          className="min-h-7 items-center"
          meta={
            draft?.from && (
              <ToolbarIconButton
                aria-label={t('review.measure.scale.form.resetPoints')}
                title={t('review.measure.scale.form.resetPoints')}
                data-testid="calibration-reset-points"
                className="-my-1 -mr-1.5"
                onClick={calibration.resetPoints}
              >
                <RotateCcw aria-hidden />
              </ToolbarIconButton>
            )
          }
        >
          <span data-testid="calibration-points">{t(`review.measure.scale.form.${points}`)}</span>
        </FactRow>
        <FactRow label={t('review.measure.scale.form.length')} className="items-center">
          <QuantityInput
            value={lengthM}
            onValueChange={(value) => calibration.setLength(value)}
            unit={t('review.measure.scale.form.unit')}
            label={t('review.measure.scale.form.lengthLabel')}
            positive
            min={0}
            max={100_000}
            step={0.01}
            settleMs={150}
            invalidMessage={() => t('review.measure.scale.form.lengthInvalid')}
          />
        </FactRow>
        <FactRow
          label={t('review.measure.scale.form.region')}
          className="min-h-7 items-center"
          meta={replacing && <span data-testid="calibration-replaces">{t('review.measure.scale.form.replaces', { ratio: replacing })}</span>}
        >
          <span data-testid="calibration-region-state" aria-describedby={refused ? refusalId : undefined}>
            {region}
          </span>
        </FactRow>
        {refused && (
          <FactLine id={refusalId} icon={TriangleAlert} tone="danger" role="alert" testId="calibration-overlaps">
            {refusedRatio
              ? t('review.measure.scale.form.overlaps', { ratio: refusedRatio })
              : t('review.measure.scale.form.overlapsPlain')}
          </FactLine>
        )}
        <FactRow label={t('review.measure.scale.form.ratio')} className="items-baseline pt-1">
          <span
            aria-live="polite"
            data-testid="calibration-ratio"
            className={cn('text-pane-title tabular-nums', !proposal.ratio && 'text-muted-foreground')}
          >
            {proposal.ratio ?? '–'}
          </span>
        </FactRow>
      </FactList>
      {next && (
        <p id={nextId} className="text-muted-foreground text-meta" data-testid="calibration-next">
          {t(`review.measure.scale.${touch ? 'nextTouch' : 'next'}.${next}`)}
        </p>
      )}
      {saveFailure?.kind === 'failed' && (
        <FactLine icon={TriangleAlert} tone="danger" role="alert" testId="calibration-save-failed">
          {t('review.measure.scale.form.saveFailed')}
        </FactLine>
      )}
      <span className="flex items-center justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" data-testid="calibration-cancel" onClick={calibration.cancel}>
          {t('review.measure.scale.form.cancel')}
        </Button>
        <BusyButton
          type="button"
          size="sm"
          data-testid="calibration-save"
          blocked={proposal.request === null}
          aria-describedby={next ? nextId : refused ? refusalId : undefined}
          busy={calibration.saving}
          busyLabel={t('review.measure.scale.form.saving')}
          onClick={() => void calibration.save()}
        >
          {t('review.measure.scale.form.save')}
        </BusyButton>
      </span>
    </form>
  )
}

export function ScaleControl({ calibration, page }: { calibration: ReviewCalibration; page: number }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  if (!calibration.shown) {
    return calibration.loading ? (
      <ToolbarTextButton disabled aria-busy data-testid="scale-button">
        {t('review.measure.scale.button.loading')}
      </ToolbarTextButton>
    ) : null
  }
  const shownPage = calibration.draft?.from ? calibration.draft.page : page
  const entries = calibration.onPage(shownPage)
  return (
    <>
      <Popover open={calibration.open} onOpenChange={calibration.setOpen} modal={false}>
        <PopoverTrigger asChild>
          <ToolbarTextButton data-testid="scale-button">
            {calibration.labelFor(page)}
          </ToolbarTextButton>
        </PopoverTrigger>
        <PopoverContent
          align="center"
          sideOffset={8}
          className="flex w-80 flex-col gap-3"
          data-testid="scale-popover"
          aria-label={t('review.measure.scale.title', { page: shownPage })}
          onInteractOutside={(event) => {
            const target = event.target
            if (calibration.setting && target instanceof Element && target.closest('[data-calibration-capture]')) {
              event.preventDefault()
            }
          }}
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <h2 className="text-name">{t('review.measure.scale.title', { page: shownPage })}</h2>
          {calibration.setting ? null : entries.length > 0 ? (
            <ul aria-label={t('review.measure.scale.listLabel', { page: shownPage })} data-testid="calibration-list" className="-my-2 flex flex-col">
              {entries.map((entry) => (
                <CalibrationRow key={entry.id} entry={entry} calibration={calibration} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground text-meta" data-testid="calibration-none">
              {t('review.measure.scale.none')}
            </p>
          )}
          {calibration.setting ? (
            <SetForm calibration={calibration} />
          ) : calibration.canCalibrate ? (
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
        </PopoverContent>
      </Popover>
      <span role="status" className="sr-only" data-testid="calibration-said">
        {calibration.said}
      </span>
    </>
  )
}
