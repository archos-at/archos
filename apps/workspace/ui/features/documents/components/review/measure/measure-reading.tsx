'use client'

import type { JSX, ReactNode } from 'react'
import { CircleSlash, Ruler, ShieldCheck, TriangleAlert, Wrench, type LucideIcon } from 'lucide-react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { FactLine, type FactTone } from '@/components/ui/fact-line'
import { FloatingCard, FloatingCardActions, FloatingCardTitle } from '@/components/ui/floating-card'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import type { KeptReading, ScaleState } from '@/lib/annotations/measure-shapes'
import type { TapeNoNumber } from '@/lib/drawing-tape/wire'
import { formatReading, formatScaleRatio } from './tape-format'

/** What a reading card shows of a measurement: the kept fields, and the scale's ratio where the engine gave one. */
export type ShownReading = KeptReading & { scaleRatio?: number | null }

/** How much a scale state may be relied on, said by glyph and tone as well as words. */
const SCALE_FACT: Record<ScaleState, { icon: LucideIcon; tone: FactTone }> = {
  verified: { icon: ShieldCheck, tone: 'default' },
  estimated: { icon: TriangleAlert, tone: 'warning' },
  uncalibrated: { icon: CircleSlash, tone: 'warning' },
}

/** „4,000 m“: a kept measurement's value where a row has one clause for it (the list of marks). */
export function ReadingValue({ reading }: { reading: Pick<KeptReading, 'value' | 'unit'> }): JSX.Element {
  const { locale } = useLocale()
  return (
    <span className="text-foreground font-medium whitespace-nowrap tabular-nums" data-testid="measure-value">
      {formatReading(reading.value, reading.unit, locale)}
    </span>
  )
}

/** The lines of a measurement: the value, its interval, where it came from and the scale it rests on. */
function ReadingLines({ reading }: { reading: ShownReading }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const scale = SCALE_FACT[reading.scaleState]
  const ratio = reading.scaleRatio ? formatScaleRatio(reading.scaleRatio, locale) : null
  return (
    <>
      <FloatingCardTitle data-testid="measure-reading-value">{formatReading(reading.value, reading.unit, locale)}</FloatingCardTitle>
      <p className="text-muted-foreground tabular-nums" data-testid="measure-reading-interval">
        {t('review.measure.interval', {
          low: formatReading(reading.low, reading.unit, locale),
          high: formatReading(reading.high, reading.unit, locale),
        })}
      </p>
      <FactLine icon={Ruler} testId="measure-reading-provenance" data-provenance={reading.provenance}>
        {t(`review.measure.provenance.${reading.provenance}`)}
      </FactLine>
      <FactLine icon={scale.icon} tone={scale.tone} testId="measure-reading-scale" data-scale-state={reading.scaleState}>
        {ratio
          ? t(`review.measure.scaleWithRatio.${reading.scaleState}`, { ratio })
          : t(`review.measure.scale.${reading.scaleState}`)}
      </FactLine>
    </>
  )
}

/** No number: the engine's reason, and what it says would help. Its words are shown as it gave them. */
function RefusalLines({ refusal }: { refusal: Pick<TapeNoNumber, 'reason' | 'remedy' | 'scaleState'> }): JSX.Element {
  const t = useTranslations(filesCopy)
  return (
    <>
      <FloatingCardTitle data-testid="measure-refusal-title">{t('review.measure.noNumber')}</FloatingCardTitle>
      <FactLine icon={CircleSlash} tone="warning" testId="measure-refusal-reason" data-scale-state={refusal.scaleState ?? undefined}>
        {refusal.reason}
      </FactLine>
      {refusal.remedy && (
        <FactLine icon={Wrench} tone="default" testId="measure-refusal-remedy">
          {refusal.remedy}
        </FactLine>
      )}
    </>
  )
}

/**
 * The reading beside a shape on the sheet: a measurement as the engine
 * answered it, or its refusal with the remedy. With `onKeep` it is the tape in
 * hand (keep it on the sheet, or discard it); without, a kept measurement
 * being read.
 */
export function MeasureReadingCard({
  reading,
  refusal,
  busy = false,
  failed = false,
  onKeep,
  onDiscard,
  children,
}: {
  reading?: ShownReading | null
  refusal?: Pick<TapeNoNumber, 'reason' | 'remedy' | 'scaleState'> | null
  /** A request is out: the card says it is measuring until an answer stands. */
  busy?: boolean
  failed?: boolean
  onKeep?: () => void
  onDiscard?: () => void
  children?: ReactNode
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  if (!reading && !refusal && !busy && !failed) return null
  return (
    <FloatingCard role="group" aria-label={t('review.measure.readingLabel')} data-testid="measure-reading" aria-busy={busy}>
      {reading && <ReadingLines reading={reading} />}
      {!reading && refusal && <RefusalLines refusal={refusal} />}
      {!reading && !refusal && busy && <p className="text-muted-foreground">{t('review.measure.measuring')}</p>}
      {failed && (
        <FactLine icon={TriangleAlert} tone="danger" role="alert" testId="measure-failed">
          {t('review.measure.failed')}
        </FactLine>
      )}
      {children}
      {(onKeep || onDiscard) && (reading || refusal || failed) && (
        <FloatingCardActions>
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
        </FloatingCardActions>
      )}
    </FloatingCard>
  )
}
