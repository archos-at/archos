'use client'

import { useId, useMemo, useRef, type JSX, type RefObject } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BusyButton } from '@/components/ui/busy-button'
import { FactLine } from '@/components/ui/fact-line'
import { FactList, FactRow } from '@/components/ui/fact-list'
import { QuantityInput } from '@/components/ui/quantity-input'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { CLAUSE_JOIN, formatMetres } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ReviewCalibration } from '../../../hooks/use-review-calibration'
import { regionName, type Framed } from '../../../lib/calibration-draft'

export const LENGTH_FIELD = 'pointer-coarse:h-11 font-sans'

export function useRegionWords(calibration: ReviewCalibration) {
  const t = useTranslations(filesCopy)
  return (entry: Framed): string => {
    const name = regionName(entry, calibration.calibrations)
    if (name.kind === 'place') return t(`review.measure.scale.where.${name.place}`)
    const place = t(`review.measure.scale.side.${name.place}`)
    const ratio = calibration.ratioOf(name.within)
    return ratio
      ? t('review.measure.scale.detail', { ratio, place })
      : t('review.measure.scale.detailPlain', { place })
  }
}

function StandardOffer({ calibration }: { calibration: ReviewCalibration }): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { standard } = calibration.proposal
  if (!standard) return null
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      data-testid="calibration-standard"
      onClick={calibration.takeStandard}
    >
      {t('review.measure.scale.form.useStandard', { ratio: standard.ratio })}
    </Button>
  )
}

export function ReviewForm({
  calibration,
  compact = false,
}: {
  calibration: ReviewCalibration
  compact?: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const words = useRegionWords(calibration)
  const reasonId = useId()
  const refusalId = useId()
  const { draft, proposal, lengthM, saveFailure } = calibration
  const refusedBy =
    proposal.overlaps ??
    (saveFailure?.kind === 'overlaps'
      ? (calibration.calibrations.find((entry) => entry.id === saveFailure.overlapping) ?? null)
      : null)
  const refused = proposal.blocked === 'overlaps' || saveFailure?.kind === 'overlaps'
  const refusedRatio = refusedBy ? calibration.ratioOf(refusedBy) : null
  const region =
    proposal.blocked === 'regionMisses' || !draft?.region
      ? t('review.measure.scale.form.regionMisses')
      : words({ id: proposal.replaces?.id ?? 'draft', page: draft.page, region: draft.region })
  const replacing = proposal.replaces ? calibration.ratioOf(proposal.replaces) : null
  const reason =
    proposal.blocked === 'length' ||
    proposal.blocked === 'regionMisses' ||
    proposal.blocked === 'overlaps'
      ? t(`review.measure.scale.blocked.${proposal.blocked}`)
      : null
  const replaces = replacing && (
    <span data-testid="calibration-replaces">
      {t('review.measure.scale.form.replaces', { ratio: replacing })}
    </span>
  )
  const regionState = (
    <span data-testid="calibration-region-state" aria-describedby={refused ? refusalId : undefined}>
      {region}
    </span>
  )
  return (
    <form
      data-testid="calibration-form"
      className="flex flex-col gap-3"
      onSubmit={(event) => event.preventDefault()}
    >
      <FactList className="gap-2">
        {compact ? (
          <p
            className="text-muted-foreground text-meta text-pretty"
            data-testid="calibration-review-facts"
          >
            {lengthM !== null && `${formatMetres(lengthM, locale)}${CLAUSE_JOIN}`}
            {regionState}
            {replaces && (
              <>
                {CLAUSE_JOIN}
                {replaces}
              </>
            )}
          </p>
        ) : (
          <>
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
                inputClassName={LENGTH_FIELD}
                invalidMessage={() => t('review.measure.scale.form.lengthInvalid')}
              />
            </FactRow>
            <FactRow
              label={t('review.measure.scale.form.region')}
              className="min-h-7 items-center"
              meta={replaces}
            >
              {regionState}
            </FactRow>
          </>
        )}
        {refused && (
          <FactLine
            id={refusalId}
            icon={TriangleAlert}
            tone="danger"
            role="alert"
            testId="calibration-overlaps"
          >
            {refusedRatio
              ? t('review.measure.scale.form.overlaps', { ratio: refusedRatio })
              : t('review.measure.scale.form.overlapsPlain')}
          </FactLine>
        )}
        <FactRow
          label={t('review.measure.scale.form.ratio')}
          className="min-h-9 items-center pt-1"
          meta={<StandardOffer calibration={calibration} />}
        >
          <span
            aria-live="polite"
            data-testid="calibration-ratio"
            className={cn(
              'text-pane-title tabular-nums',
              !proposal.ratio && 'text-muted-foreground'
            )}
          >
            {proposal.ratio ?? '–'}
          </span>
        </FactRow>
      </FactList>
      {saveFailure?.kind === 'failed' && (
        <FactLine icon={TriangleAlert} tone="danger" role="alert" testId="calibration-save-failed">
          {t('review.measure.scale.form.saveFailed')}
        </FactLine>
      )}
      <span className="flex items-center gap-2">
        <span
          id={reasonId}
          className="text-muted-foreground text-meta min-w-0 flex-1"
          data-testid="calibration-save-reason"
        >
          {reason}
        </span>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid="calibration-back"
          onClick={calibration.back}
        >
          {t('review.measure.scale.steps.back')}
        </Button>
        <BusyButton
          type="button"
          size="sm"
          data-testid="calibration-save"
          blocked={proposal.request === null}
          aria-describedby={reason ? reasonId : undefined}
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

const REVIEW_ROOM = 360
type DraftPart = 'frame' | 'end'

function boundsOf(layer: HTMLElement | null, parts: readonly DraftPart[]): DOMRect | null {
  const selector = parts.map((part) => `[data-draft-part="${part}"]`).join(',')
  const rects = layer
    ? [...layer.querySelectorAll(selector)].map((node) => node.getBoundingClientRect())
    : []
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((rect) => rect.left))
  const top = Math.min(...rects.map((rect) => rect.top))
  const right = Math.max(...rects.map((rect) => rect.right))
  const bottom = Math.max(...rects.map((rect) => rect.bottom))
  return new DOMRect(left, top, right - left, bottom - top)
}

export function useReviewAnchor(layer: RefObject<HTMLElement | null>, reviewing: boolean) {
  const whole = reviewing ? boundsOf(layer.current, ['frame', 'end']) : null
  const right = whole ? window.innerWidth - whole.right : 0
  const left = whole ? whole.left : 0
  const beside = Math.max(right, left) >= REVIEW_ROOM
  const parts = useRef<readonly DraftPart[]>(['frame', 'end'])
  parts.current = beside ? ['frame', 'end'] : ['end']
  const virtualRef = useMemo(
    () => ({
      current: {
        getBoundingClientRect: () =>
          boundsOf(layer.current, parts.current) ??
          layer.current?.getBoundingClientRect() ??
          new DOMRect(),
      },
    }),
    [layer]
  )
  const side: 'right' | 'left' | 'bottom' = !beside
    ? 'bottom'
    : right >= REVIEW_ROOM
      ? 'right'
      : 'left'
  return { shown: whole !== null, virtualRef, side }
}
