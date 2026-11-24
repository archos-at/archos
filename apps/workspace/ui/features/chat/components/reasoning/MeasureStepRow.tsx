'use client'

import type { FC } from 'react'
import { PagePlaceButton, type DrawnFrame } from '@/features/knowledge'
import { useLocale, useTranslations } from '@/i18n'
import { chatCopy } from '@/i18n/namespaces/chat'
import {
  basisLine,
  labelPoint,
  measuredValue,
  pointsInMark,
  type MeasureStepPlace,
} from '../../lib/measure-steps'
import { STRIP_MAX_HEIGHT, STRIP_WIDTH } from './LookStrip'

const MARKER_RADIUS = 4

const square = ([x, y]: readonly [number, number]): string =>
  `M ${x - MARKER_RADIUS} ${y - MARKER_RADIUS} h ${MARKER_RADIUS * 2} v ${MARKER_RADIUS * 2} h ${-MARKER_RADIUS * 2} Z`

export const MeasuredShape: FC<{
  measured: MeasureStepPlace
  frame: DrawnFrame
  label: string
}> = ({ measured, frame, label }) => {
  const { shape, box } = measured
  const shares = pointsInMark(box, frame.mark, shape.points)
  const pixels = shares.map(([x, y]) => [x * frame.width, y * frame.height] as const)
  const line = pixels.map(([x, y]) => `${x},${y}`).join(' ')
  const area = shape.quantity === 'area'
  const ends = area ? pixels : [pixels[0], pixels[pixels.length - 1]]
  const [labelX, labelY] = labelPoint(shape.quantity, shares)
  const Path = area ? 'polygon' : 'polyline'
  return (
    <>
      <svg
        aria-hidden
        data-testid="measure-shape"
        data-quantity={shape.quantity}
        viewBox={`0 0 ${frame.width} ${frame.height}`}
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        <Path
          points={line}
          fill="none"
          stroke="var(--background)"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <Path
          points={line}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {ends.map((point, index) => (
          <path
            key={index}
            d={square(point)}
            fill="var(--background)"
            stroke="var(--foreground)"
            strokeWidth={1.5}
          />
        ))}
      </svg>
      <span
        data-testid="measure-label"
        className="bg-sheet text-meta pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 font-medium whitespace-nowrap tabular-nums shadow-xs"
        style={{ left: `${labelX * 100}%`, top: `${labelY * 100}%` }}
      >
        {label}
      </span>
    </>
  )
}

export const MeasureStepRow: FC<{
  measured: MeasureStepPlace
  eager?: boolean
  compact?: boolean
}> = ({ measured, eager, compact }) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const value = measuredValue(measured.shape, locale)
  const { place } = measured
  return (
    <div
      data-testid="measure-step"
      data-basis={measured.shape.basis}
      className={
        compact
          ? 'mb-2 ml-[26px] flex flex-col items-start gap-2.5'
          : 'mb-2 ml-[26px] flex items-end gap-2.5'
      }
    >
      <PagePlaceButton
        place={place}
        label={t('thinking.measure.open', { document: place.document.name, page: place.page })}
        thumbnailWidth={STRIP_WIDTH}
        thumbnailMaxHeight={STRIP_MAX_HEIGHT}
        eager={eager}
        overlay={(frame) => <MeasuredShape measured={measured} frame={frame} label={value} />}
        className="shrink-0"
      />
      <span className="text-muted-foreground text-meta pb-0.5">
        {basisLine(t, measured.shape, locale)}
      </span>
    </div>
  )
}
