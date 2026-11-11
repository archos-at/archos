'use client'

/**
 * The scale of the page in view, beside the page: its active calibrations
 * (region, ratio, who, when), each to withdraw, and, with the `calibrate` tool
 * in hand, the calibration being set: the span, its true length, the region it
 * will hold for and the ratio that results, all before anything is saved.
 *
 * Folded, it is a chip that states the page's scale. Nothing of it exists
 * where the organization does not hold `drawing-measure`
 * (`calibration.shown`).
 */

import { useId, useState, type JSX } from 'react'
import { Lock, Ruler, TriangleAlert, X } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { FactLine } from '@/components/ui/fact-line'
import { FactList, FactRow } from '@/components/ui/fact-list'
import { FloatingPanel, FloatingToolbar, ToolbarIconButton, ToolbarTextButton } from '@/components/ui/floating-toolbar'
import { Kbd } from '@/components/ui/kbd'
import { QuantityInput } from '@/components/ui/quantity-input'
import { SectionLabel } from '@/components/ui/section-label'
import { TimeAgo } from '@/components/ui/time-ago'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { calibrationRatio } from '@/lib/drawing-calibrations/display-ratio'
import type { CalibrationRegion, CalibrationView } from '@/lib/drawing-calibrations/wire'
import { formatDecimalInput } from '@/lib/text/parse-decimal'
import { cn } from '@/lib/utils'
import type { ReviewCalibration } from '../../hooks/use-review-calibration'

/** The key that takes the tool up, as the palette states it. */
export const CALIBRATE_KEY = 'M'

/** Where a region lies on its page, as a small picture of the page: read at a glance, where a row of percentages is not. */
function RegionThumb({ region }: { region: CalibrationRegion }): JSX.Element {
  return (
    <span aria-hidden data-slot="region-thumb" className="border-border bg-card relative mt-0.5 block h-7 w-9 shrink-0 rounded-[2px] border">
      <span
        className="bg-foreground/60 absolute rounded-[1px]"
        style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.w * 100}%`, height: `${region.h * 100}%` }}
      />
    </span>
  )
}

/** One active calibration: where it holds, the ratio, the reference length, who set it and when. */
function CalibrationRow({
  entry,
  ratio,
  calibration,
  onWithdraw,
}: {
  entry: CalibrationView
  ratio: string | null
  calibration: ReviewCalibration
  onWithdraw: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const who = entry.createdBy === calibration.me ? t('review.calibrate.you') : calibration.nameOf(entry.createdBy)
  return (
    <li
      data-testid={`calibration-row-${entry.id}`}
      className="flex items-start gap-2.5"
      onPointerEnter={() => calibration.hover(entry.id)}
      onPointerLeave={() => calibration.hover(null)}
      onFocus={() => calibration.hover(entry.id)}
      onBlur={() => calibration.hover(null)}
    >
      <RegionThumb region={entry.region} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-h-7 items-center justify-between gap-2">
          <span className="text-sm leading-5 font-medium tabular-nums" data-testid="calibration-row-ratio">
            {ratio ?? t('review.calibrate.ratioPending')}
          </span>
          {calibration.canCalibrate && (
            <Button type="button" variant="ghost" size="sm" className="-mr-1.5 h-7 shrink-0 px-2" data-testid="calibration-withdraw" onClick={onWithdraw}>
              {t('review.calibrate.withdraw')}
            </Button>
          )}
        </span>
        <span className="text-muted-foreground text-xs leading-4 [overflow-wrap:anywhere]">
          {t('review.calibrate.reference', { length: formatDecimalInput(entry.lengthM, locale) })}
          {who && <> · {who}</>}
          {' · '}
          <TimeAgo date={entry.createdAt} locale={locale} />
        </span>
      </span>
    </li>
  )
}

/** The calibration being set: what is there, what it gives, and the one thing still missing. */
function CalibrationForm({ calibration }: { calibration: ReviewCalibration }): JSX.Element {
  const t = useTranslations(filesCopy)
  const nextId = useId()
  const { draft, proposal, lengthM } = calibration
  const points = !draft ? 'spanNone' : draft.to ? 'spanSet' : 'spanOne'
  const region =
    proposal.regionSource === 'stored'
      ? 'regionStored'
      : proposal.regionSource === 'drawn'
        ? 'regionDrawn'
        : proposal.blocked === 'regionMisses'
          ? 'regionMisses'
          : 'regionMissing'
  // The one thing to do next, in the order a person meets them. It is also why Save cannot be pressed yet.
  const next = !draft ? 'firstPoint' : proposal.blocked
  return (
    <form
      data-testid="calibration-form"
      className="flex flex-col gap-3"
      // Enter in the length field settles the length; saving is its own press, so a typed value is seen as a ratio first.
      onSubmit={(event) => event.preventDefault()}
    >
      <FactList className="gap-2">
        <FactRow
          label={t('review.calibrate.form.span')}
          meta={
            draft && (
              <Button type="button" variant="inline" data-testid="calibration-reset-points" onClick={calibration.resetPoints}>
                {t('review.calibrate.form.resetPoints')}
              </Button>
            )
          }
        >
          <span data-testid="calibration-points">{t(`review.calibrate.form.${points}`)}</span>
        </FactRow>
        <FactRow label={t('review.calibrate.form.length')} className="items-center">
          <QuantityInput
            value={lengthM}
            onValueChange={(value) => calibration.setLength(value)}
            unit={t('review.calibrate.form.unit')}
            label={t('review.calibrate.form.lengthLabel')}
            positive
            min={0}
            max={100_000}
            step={0.01}
            settleMs={150}
            invalidMessage={() => t('review.calibrate.form.lengthInvalid')}
            className="[&_input]:w-24 [&_input]:text-right"
          />
        </FactRow>
        <FactRow label={t('review.calibrate.form.region')}>
          <span data-testid="calibration-region-state">{t(`review.calibrate.form.${region}`)}</span>
        </FactRow>
      </FactList>
      <p className="border-border flex items-baseline justify-between gap-3 border-t pt-3" aria-live="polite">
        <span className="text-muted-foreground text-xs">{t('review.calibrate.form.ratio')}</span>
        <span className={cn('text-xl leading-6 font-semibold tabular-nums', !proposal.ratio && 'text-muted-foreground')} data-testid="calibration-ratio">
          {proposal.ratio ?? t('review.calibrate.ratioPending')}
        </span>
      </p>
      {next && (
        <p id={nextId} className="text-foreground text-xs leading-snug" data-testid="calibration-next">
          {t(`review.calibrate.next.${next}`)}
        </p>
      )}
      {calibration.failure === 'save' && (
        <FactLine icon={TriangleAlert} tone="danger" role="alert" testId="calibration-save-failed">
          {t('review.calibrate.saveFailed')}
        </FactLine>
      )}
      <span className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" data-testid="calibration-cancel" onClick={calibration.cancel}>
          {t('review.calibrate.cancel')}
        </Button>
        <BusyButton
          type="button"
          size="sm"
          data-testid="calibration-save"
          onClick={() => void calibration.save()}
          disabled={proposal.request === null}
          aria-describedby={next ? nextId : undefined}
          busy={calibration.saving}
          busyLabel={t('review.calibrate.saving')}
        >
          {t('review.calibrate.save')}
        </BusyButton>
      </span>
    </form>
  )
}

export function CalibrationPanel({
  calibration,
  page,
  className,
}: {
  calibration: ReviewCalibration
  /** The page in view: the scale shown is this page's. */
  page: number
  /** Where the panel floats; the review anchors it to the canvas's upper right. */
  className?: string
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const [withdrawing, setWithdrawing] = useState<{ entry: CalibrationView; ratio: string | null } | null>(null)
  if (!calibration.shown) return null

  // While one is being set, the panel is about the page it is set on.
  const shownPage = calibration.draft?.page ?? page
  const entries = calibration.onPage(shownPage)
  const pageSize = calibration.pageSizes[shownPage]
  const ratioOf = (entry: CalibrationView) => (pageSize ? calibrationRatio(entry, pageSize) : null)

  if (!calibration.open) {
    const first = entries[0]
    const only = entries.length === 1 && first ? ratioOf(first) : null
    const label =
      entries.length === 0
        ? t('review.calibrate.chipNone')
        : only
          ? t('review.calibrate.chip', { ratio: only })
          : t('review.calibrate.chipSeveral', { count: entries.length })
    return (
      <FloatingToolbar className={className}>
        <ToolbarTextButton data-testid="calibration-chip" aria-expanded={false} className="gap-1.5 [&_svg]:size-3.5" onClick={() => calibration.setOpen(true)}>
          <Ruler aria-hidden />
          {label}
        </ToolbarTextButton>
      </FloatingToolbar>
    )
  }

  return (
    <FloatingPanel className={cn('w-80 max-w-[calc(100%-1.5rem)]', className)} data-testid="calibration-panel" aria-label={t('review.calibrate.title')}>
      <header className="flex items-center gap-2">
        <SectionLabel as="h2" icon={Ruler} className="flex-1">
          {t('review.calibrate.titlePage', { page: shownPage })}
        </SectionLabel>
        <ToolbarIconButton
          aria-label={t('review.calibrate.close')}
          title={t('review.calibrate.close')}
          data-testid="calibration-close"
          className="-my-1 -mr-1"
          onClick={() => {
            if (calibration.active) calibration.cancel()
            calibration.setOpen(false)
          }}
        >
          <X aria-hidden />
        </ToolbarIconButton>
      </header>
      {entries.length > 0 ? (
        <ul className="flex flex-col gap-2.5" aria-label={t('review.calibrate.listLabel', { page: shownPage })} data-testid="calibration-list">
          {entries.map((entry) => (
            <CalibrationRow
              key={entry.id}
              entry={entry}
              ratio={ratioOf(entry)}
              calibration={calibration}
              onWithdraw={() => setWithdrawing({ entry, ratio: ratioOf(entry) })}
            />
          ))}
        </ul>
      ) : (
        !calibration.active && (
          <p className="text-muted-foreground text-xs leading-snug" data-testid="calibration-none">
            {t('review.calibrate.none')}
          </p>
        )
      )}
      {calibration.failure === 'withdraw' && (
        <FactLine icon={TriangleAlert} tone="danger" role="alert" testId="calibration-withdraw-failed">
          {t('review.calibrate.withdrawFailed')}
        </FactLine>
      )}
      {calibration.active ? (
        <CalibrationForm calibration={calibration} />
      ) : calibration.canCalibrate ? (
        <Button type="button" variant="secondary" size="sm" className="self-start" data-testid="calibration-start" onClick={calibration.begin}>
          {t('review.calibrate.start')}
          <Kbd className="ml-1">{CALIBRATE_KEY}</Kbd>
        </Button>
      ) : (
        <FactLine icon={Lock} testId="calibration-not-allowed">
          {t('review.calibrate.notAllowed')}
        </FactLine>
      )}
      <ConfirmDialog
        open={withdrawing !== null}
        onOpenChange={(next) => !next && setWithdrawing(null)}
        title={
          withdrawing?.ratio
            ? t('review.calibrate.withdrawConfirm', { ratio: withdrawing.ratio })
            : t('review.calibrate.withdrawConfirmPlain')
        }
        description={t('review.calibrate.withdrawConfirmBody')}
        tone="warning"
        confirmLabel={t('review.calibrate.withdraw')}
        cancelLabel={t('review.calibrate.cancel')}
        confirmTestId="calibration-withdraw-confirm"
        onConfirm={async () => {
          if (withdrawing) await calibration.withdraw(withdrawing.entry.id)
        }}
      />
    </FloatingPanel>
  )
}
