'use client'

import type { JSX } from 'react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { FloatingPanel } from '@/components/ui/floating-toolbar'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { CLAUSE_JOIN } from '@/lib/format'
import type { KeptReading } from '@/lib/annotations/measure-shapes'
import type { TapeCode, TapeNoNumber } from '@/lib/drawing-tape/wire'
import { ReadingActions, ReadingBasis, ReadingText, ReadingTitle } from './sheet-shape'
import { formatRounded, formatScaleRatio, formatTolerance } from './tape-format'

/** What a reading card shows of a measurement: the fields a kept mark stores (a measurement in hand has the same). */
export type ShownReading = KeptReading

/** What the card needs of a refusal: its code, and the engine's own words for whoever supports the person. */
export type ShownRefusal = Pick<TapeNoNumber, 'code'> & Partial<Pick<TapeNoNumber, 'reason' | 'remedy'>>

/** „7,39 m“: a kept measurement's value, rounded as its tolerance supports (the list of marks, the tag on the sheet). */
export function ReadingValue({ reading }: { reading: Pick<KeptReading, 'value' | 'unit' | 'low' | 'high'> }): JSX.Element {
  const { locale } = useLocale()
  return (
    <span className="text-foreground font-medium whitespace-nowrap tabular-nums" data-testid="measure-value">
      {formatRounded(reading, locale)}
    </span>
  )
}

/**
 * A measurement as a person reads it: the value with its tolerance, and one
 * line saying what it rests on. A value at a scale nobody confirmed says so
 * and offers to calibrate; a value read off a printed dimension says which.
 */
function ReadingLines({ reading, onCalibrate }: { reading: ShownReading; onCalibrate?: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const ratio = reading.scaleRatio ? formatScaleRatio(reading.scaleRatio, locale) : null
  const estimated = reading.provenance === 'vector_estimated'
  const basis =
    reading.provenance === 'printed_figure'
      ? reading.printed
        ? t('review.measure.basis.printed', { figure: reading.printed })
        : t('review.measure.basis.printedNoFigure')
      : ratio
        ? t(`review.measure.basis.${estimated ? 'estimatedRatio' : 'verifiedRatio'}`, { ratio })
        : t(`review.measure.basis.${estimated ? 'estimated' : 'verified'}`)
  return (
    <>
      <ReadingTitle data-testid="measure-reading-value">
        {/* A printed dimension is what the sheet says: it is shown as printed, without a tolerance of ours. */}
        {reading.provenance === 'printed_figure'
          ? formatRounded(reading, locale)
          : t('review.measure.withTolerance', {
              value: formatRounded(reading, locale),
              tolerance: formatTolerance(reading, locale),
            })}
      </ReadingTitle>
      <ReadingBasis data-testid="measure-reading-basis" data-provenance={reading.provenance}>
        {basis}
      </ReadingBasis>
      {estimated && onCalibrate && <CalibrateButton onCalibrate={onCalibrate} />}
    </>
  )
}

/** The one way on from a scale nobody confirmed: the review's own tool for it. */
function CalibrateButton({ onCalibrate }: { onCalibrate: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <Button type="button" variant="inline" className="self-start underline underline-offset-2" onClick={onCalibrate} data-testid="measure-calibrate">
      {t('review.measure.calibrate')}
    </Button>
  )
}

/**
 * No number: one sentence in the reader's language, chosen by the engine's
 * code, and at most one thing to do about it. The engine's own English words
 * are never the card's text; they ride on the sentence as a tooltip for
 * whoever is asked what happened.
 */
function RefusalLines({ refusal, onCalibrate }: { refusal: ShownRefusal; onCalibrate?: () => void }): JSX.Element {
  const t = useTranslations(filesCopy)
  const detail = [refusal.reason, refusal.remedy].filter(Boolean).join(CLAUSE_JOIN) || undefined
  return (
    <>
      <ReadingText title={detail} data-testid="measure-refusal" data-code={refusal.code}>
        {t(`review.measure.refused.${refusal.code}`)}
      </ReadingText>
      {refusal.code === 'uncalibrated' && onCalibrate && <CalibrateButton onCalibrate={onCalibrate} />}
    </>
  )
}

/** The sentence for a code, where a card is too much: a click the engine tied nowhere. */
export function useRefusalSentence(): (code: TapeCode) => string {
  const t = useTranslations(filesCopy)
  return (code) => t(`review.measure.refused.${code}`)
}

/**
 * The reading beside a shape on the sheet: a measurement, or the sentence for
 * why there is none. With `onKeep` it is the tape in hand (keep it on the
 * sheet, or discard it); without, a kept measurement being read.
 */
export function MeasureReadingCard({
  reading,
  refusal,
  busy = false,
  failed = false,
  onKeep,
  onDiscard,
  onCalibrate,
}: {
  reading?: ShownReading | null
  refusal?: ShownRefusal | null
  /** A request is out: the card says it is measuring until an answer stands. */
  busy?: boolean
  failed?: boolean
  onKeep?: () => void
  onDiscard?: () => void
  /** Take up the calibrate tool; absent for a reader who may not calibrate. */
  onCalibrate?: () => void
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  if (!reading && !refusal && !busy && !failed) return null
  return (
    <FloatingPanel
      role="group"
      aria-label={t('review.measure.readingLabel')}
      aria-busy={busy}
      data-testid="measure-reading"
      className="w-max max-w-[20rem] gap-1.5 px-3 py-2.5 text-xs"
    >
      {reading && <ReadingLines reading={reading} onCalibrate={onCalibrate} />}
      {!reading && refusal && <RefusalLines refusal={refusal} onCalibrate={onCalibrate} />}
      {!reading && !refusal && busy && <ReadingBasis>{t('review.measure.measuring')}</ReadingBasis>}
      {failed && (
        <ReadingText role="alert" data-testid="measure-failed">
          {t('review.measure.failed')}
        </ReadingText>
      )}
      {(onKeep || onDiscard) && (reading || refusal || failed) && (
        <ReadingActions>
          {onKeep && reading && (
            <BusyButton size="sm" busy={busy} busyLabel={t('review.measure.keeping')} onClick={onKeep} data-testid="measure-keep">
              {t('review.measure.keep')}
            </BusyButton>
          )}
          {onDiscard && (
            <Button type="button" size="sm" variant="ghost" onClick={onDiscard} data-testid="measure-discard">
              {t('review.measure.discard')}
            </Button>
          )}
        </ReadingActions>
      )}
    </FloatingPanel>
  )
}
