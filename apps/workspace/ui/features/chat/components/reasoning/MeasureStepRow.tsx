'use client'

import type { FC } from 'react'
import { ChevronRight } from 'lucide-react'
import { PagePlaceButton, type DrawnFrame } from '@/features/knowledge/page-clip'
import { useMediaQuery } from '@/hooks/use-media-query'
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

const PHONE = '(max-width: 639px)'
const PHONE_MAX_HEIGHT = 220

export const MeasuredShape: FC<{
  measured: MeasureStepPlace
  frame: DrawnFrame
  label?: string
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
      {label && (
        <span
          data-testid="measure-label"
          className="bg-sheet text-meta pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 font-medium whitespace-nowrap tabular-nums shadow-xs"
          style={{ left: `${labelX * 100}%`, top: `${labelY * 100}%` }}
        >
          {label}
        </span>
      )}
    </>
  )
}

const pct = (share: number): string => `${share * 100}%`

export const MeasuredOnPage: FC<{ measured: MeasureStepPlace; label: string }> = ({
  measured,
  label,
}) => {
  const { points, quantity } = measured.shape
  const area = quantity === 'area'
  const segments = points
    .slice(1)
    .map((point, index) => [points[index], point] as const)
    .concat(area ? [[points[points.length - 1], points[0]] as const] : [])
  const ends = area ? points : [points[0], points[points.length - 1]]
  const [labelX, labelY] = labelPoint(quantity, points)
  const stroke = (color: string, width: number) =>
    segments.map(([a, b], index) => (
      <line
        key={`${color}-${index}`}
        x1={pct(a[0])}
        y1={pct(a[1])}
        x2={pct(b[0])}
        y2={pct(b[1])}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    ))
  return (
    <>
      <svg
        aria-hidden
        data-testid="measure-on-page"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        {stroke('var(--background)', 4)}
        {stroke('var(--foreground)', 1.5)}
        {ends.map(([x, y], index) => (
          <svg key={index} x={pct(x)} y={pct(y)} overflow="visible">
            <path
              d={square([0, 0])}
              fill="var(--background)"
              stroke="var(--foreground)"
              strokeWidth={1.5}
            />
          </svg>
        ))}
      </svg>
      <span
        className="bg-sheet text-meta pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-full px-1.5 font-medium whitespace-nowrap tabular-nums shadow-xs"
        style={{ left: pct(labelX), top: pct(labelY) }}
      >
        {label}
      </span>
    </>
  )
}

export const MeasureStepRow: FC<{
  measured: MeasureStepPlace
  eager?: boolean
}> = ({ measured, eager }) => {
  const t = useTranslations(chatCopy)
  const { locale } = useLocale()
  const phone = useMediaQuery(PHONE)
  const { place } = measured
  return (
    <div data-testid="measure-step" data-basis={measured.shape.basis} className="mb-2 ml-[26px]">
      <PagePlaceButton
        place={place}
        label={t('thinking.measure.open', { document: place.document.name, page: place.page })}
        thumbnailWidth={phone ? undefined : STRIP_WIDTH}
        thumbnailMaxHeight={phone ? PHONE_MAX_HEIGHT : STRIP_MAX_HEIGHT}
        eager={eager}
        overlay={(frame) => <MeasuredShape measured={measured} frame={frame} />}
        pageOverlay={
          <MeasuredOnPage measured={measured} label={measuredValue(measured.shape, locale)} />
        }
        zoomToRegion
        className={phone ? 'w-full' : 'max-w-full'}
      >
        <span className="text-meta text-muted-foreground" data-testid="measure-basis">
          {basisLine(t, measured.shape, locale)}
        </span>
        <span className="text-meta text-foreground inline-flex items-center gap-0.5">
          {t('thinking.measure.show')}
          <ChevronRight aria-hidden className="size-3.5" />
        </span>
      </PagePlaceButton>
    </div>
  )
}
