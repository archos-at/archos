'use client'

import type { JSX, ReactNode } from 'react'
import { Ruler } from 'lucide-react'
import { useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { useLocale } from '@/i18n'
import { isLive, isMeasurement, type AnnotationView } from '@/lib/annotations/types'
import { formatRounded } from '../../lib/tape-format'
import type { MeasurementTotal } from './measurement-total'

export const keptMeasurements = (annotations: readonly AnnotationView[]): AnnotationView[] =>
  annotations
    .filter((annotation) => isMeasurement(annotation) && isLive(annotation))
    .sort((a, b) => a.page - b.page || a.number - b.number)

export function MeasurementsGroup({
  count,
  totals = [],
  children,
}: {
  count: number
  totals?: readonly MeasurementTotal[]
  children: ReactNode
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  return (
    <section data-testid="review-measurements" aria-label={t('review.measurementsGroup')} className="mt-3 border-t pt-1">
      <h3 className="text-muted-foreground flex items-center gap-1.5 px-2.5 pt-2 text-[11px] font-medium">
        <Ruler className="size-3.5" aria-hidden />
        {t('review.measurementsGroup')}
        <span className="tabular-nums">{count}</span>
      </h3>
      <p className="text-muted-foreground px-2.5 pb-1 text-[11px] leading-4">{t('review.measurementsLegend')}</p>
      <ul className="space-y-0.5">{children}</ul>
      {totals.map((total) => (
        <p
          key={total.unit}
          data-testid="measurements-total"
          className="text-meta text-foreground flex justify-between gap-2 border-t px-2.5 pt-1.5 pb-1 tabular-nums"
        >
          <span className="text-muted-foreground">{t('review.measurementsTotal', { count: total.count })}</span>
          <span className="font-medium">{formatRounded(total, locale)}</span>
        </p>
      ))}
    </section>
  )
}
