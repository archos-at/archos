'use client'

import { useState, type JSX } from 'react'
import { BusyButton } from '@/components/ui/busy-button'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { CLAUSE_JOIN } from '@/lib/format'
import type { TapeMeasurement } from '@/lib/drawing-tape/wire'
import { formatRounded, formatScaleRatio, formatTolerance } from '../../../lib/tape-format'

export type ShownReading = Pick<TapeMeasurement, 'value' | 'unit' | 'low' | 'high' | 'provenance'> &
  Partial<Pick<TapeMeasurement, 'scaleRatio' | 'printed' | 'printedCheck' | 'perimeter'>>

export function useReadingValue(): (
  reading: Pick<ShownReading, 'value' | 'unit' | 'low' | 'high'>
) => string {
  const { locale } = useLocale()
  return (reading) => formatRounded(reading, locale)
}

function useBasis(): (reading: ShownReading) => string {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  return (reading) => {
    if (reading.provenance === 'printed_figure') {
      return reading.printed
        ? t('review.measure.basis.printed', { figure: reading.printed })
        : t('review.measure.basis.printedNoFigure')
    }
    const estimated = reading.provenance === 'vector_estimated'
    const ratio = reading.scaleRatio ? formatScaleRatio(reading.scaleRatio, locale) : null
    if (ratio)
      return t(`review.measure.basis.${estimated ? 'estimatedRatio' : 'verifiedRatio'}`, { ratio })
    return t(`review.measure.basis.${estimated ? 'estimated' : 'verified'}`)
  }
}

export function MeasureReadingLines({
  reading,
  onSetScale,
}: {
  reading: ShownReading
  onSetScale?: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const basis = useBasis()
  const value = formatRounded(reading, locale)
  const estimated = reading.provenance === 'vector_estimated'
  return (
    <div className="min-w-0 space-y-0.5" data-testid="measure-reading">
      <p className="text-section text-foreground tabular-nums" data-testid="measure-reading-value">
        {reading.provenance === 'printed_figure'
          ? value
          : t('review.measure.withTolerance', {
              value,
              tolerance: formatTolerance(reading, locale),
            })}
      </p>
      <p
        className="text-meta text-muted-foreground"
        data-testid="measure-reading-basis"
        data-provenance={reading.provenance}
      >
        {basis(reading)}
        {estimated && onSetScale && (
          <>
            {CLAUSE_JOIN}
            <Button
              type="button"
              variant="inline"
              className="text-meta h-auto p-0"
              onClick={onSetScale}
              data-testid="measure-set-scale"
            >
              {t('review.measure.setScale')}
            </Button>
          </>
        )}
      </p>
      {reading.printedCheck && (
        <p
          className={reading.printedCheck.agrees === false ? 'text-meta text-warning' : 'text-meta text-muted-foreground'}
          data-testid="measure-reading-printed"
          data-agrees={String(reading.printedCheck.agrees)}
        >
          {t(`review.measure.printedCheck.${String(reading.printedCheck.agrees)}`, { figure: reading.printedCheck.text })}
        </p>
      )}
      {reading.perimeter != null && (
        <p className="text-meta text-muted-foreground tabular-nums" data-testid="measure-reading-perimeter">
          {t('review.measure.perimeter', {
            value: formatRounded({ value: reading.perimeter, low: reading.perimeter, high: reading.perimeter, unit: 'm' }, locale),
          })}
        </p>
      )}
    </div>
  )
}

export function MeasureDraftBody({
  reading,
  onKeep,
  onDiscard,
  onSetScale,
}: {
  reading: ShownReading
  onKeep: (note: string) => Promise<unknown>
  onDiscard: () => void
  onSetScale?: () => void
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const keep = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await onKeep(note.trim())
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="space-y-3 p-3">
      <MeasureReadingLines reading={reading} onSetScale={onSetScale} />
      <Textarea
        rows={2}
        value={note}
        maxLength={2000}
        placeholder={t(reading.unit === 'm2' ? 'review.measure.notePlaceholderArea' : 'review.measure.notePlaceholder')}
        data-testid="measure-note"
        onChange={(event) => setNote(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void keep()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            onDiscard()
          }
        }}
        className="text-name min-h-0 resize-none"
      />
      {failed && (
        <p role="alert" className="text-meta text-destructive" data-testid="measure-failed">
          {t('review.measure.failed')}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onDiscard}
          data-testid="measure-discard"
        >
          {t('review.measure.discard')}
        </Button>
        <BusyButton
          size="sm"
          busy={busy}
          busyLabel={t('review.measure.keep')}
          onClick={() => void keep()}
          data-testid="measure-keep"
        >
          {t('review.measure.keep')}
        </BusyButton>
      </div>
    </div>
  )
}
