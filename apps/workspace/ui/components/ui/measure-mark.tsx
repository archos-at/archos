import type { ComponentProps, JSX } from 'react'
import { cn } from '@/lib/utils'
import {
  MEASURE_LABEL_AT_CLASS,
  MEASURE_MARKER,
  MEASURE_PROVISIONAL_SIGN,
  MEASURE_STROKE,
  MEASURE_SURFACE,
  measureLabelClass,
  measureMarkerPath,
  type MeasureMarkKind,
  type MeasureMarkPoint,
  type MeasureSurface,
} from './measure-mark-recipe'

export function MeasureLine({
  points,
  closed = false,
  placing = false,
  surface = 'scene',
  ...props
}: { points: readonly MeasureMarkPoint[]; closed?: boolean; placing?: boolean; surface?: MeasureSurface } & Omit<ComponentProps<'g'>, 'points'>): JSX.Element | null {
  if (points.length < 2) return null
  const { ink, halo } = MEASURE_SURFACE[surface]
  const path = points.map(([x, y]) => `${x},${y}`).join(' ')
  const shared = {
    points: path,
    strokeLinecap: MEASURE_STROKE.cap,
    strokeLinejoin: MEASURE_STROKE.join,
    strokeDasharray: placing ? MEASURE_STROKE.placingDash : undefined,
    vectorEffect: 'non-scaling-stroke' as const,
  }
  const Shape = closed ? 'polygon' : 'polyline'
  return (
    <g data-slot="measure-line" data-surface={surface} data-closed={closed || undefined} data-placing={placing || undefined} aria-hidden {...props}>
      <Shape data-part="halo" fill="none" stroke={halo} strokeWidth={MEASURE_STROKE.haloWidth} {...shared} />
      <Shape
        data-part="line"
        fill={closed ? ink : 'none'}
        fillOpacity={closed ? MEASURE_STROKE.areaFillOpacity : undefined}
        stroke={ink}
        strokeWidth={MEASURE_STROKE.lineWidth}
        {...shared}
      />
    </g>
  )
}

export function MeasureEnd({
  at: [x, y],
  kind,
  radius = MEASURE_MARKER.radius,
  surface = 'scene',
  ...props
}: { at: MeasureMarkPoint; kind: MeasureMarkKind; radius?: number; surface?: MeasureSurface } & Omit<ComponentProps<'path'>, 'd'>): JSX.Element {
  const { ink, halo } = MEASURE_SURFACE[surface]
  return (
    <path
      data-slot="measure-end"
      data-kind={kind}
      aria-hidden
      d={measureMarkerPath(kind, radius)}
      transform={`translate(${x} ${y})`}
      data-surface={surface}
      fill={halo}
      stroke={ink}
      strokeWidth={MEASURE_MARKER.strokeWidth}
      {...props}
    />
  )
}

export function MeasureLabel({
  x,
  y,
  provisional = false,
  surface = 'scene',
  className,
  style,
  children,
  ...props
}: { x: number; y: number; provisional?: boolean; surface?: MeasureSurface } & ComponentProps<'div'>): JSX.Element {
  return (
    <div
      data-slot="measure-label"
      data-provisional={provisional || undefined}
      data-surface={surface}
      className={cn(MEASURE_LABEL_AT_CLASS, measureLabelClass(surface, provisional), className)}
      style={{ left: x, top: y, ...style }}
      {...props}
    >
      {provisional && `${MEASURE_PROVISIONAL_SIGN} `}
      {children}
    </div>
  )
}
