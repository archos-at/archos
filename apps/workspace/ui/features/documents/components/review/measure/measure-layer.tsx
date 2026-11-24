'use client'

import type { JSX, PointerEvent as ReactPointerEvent } from 'react'
import { MeasureEnd, MeasureLabel, MeasureLine } from '@/components/ui/measure-mark'
import {
  labelAnchor,
  MEASURE_LABEL_AT_CLASS,
  measureLabelClass,
  type MeasureMarkPoint,
} from '@/components/ui/measure-mark-recipe'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { isMeasureShape, type PagePoint } from '@/lib/annotations/measure-shapes'
import { isLive, type AnnotationView } from '@/lib/annotations/types'
import { cn } from '@/lib/utils'
import type { DocumentReview } from '../../../hooks/use-document-review'
import { TAPE_SHAPE, type PageSize } from '../../../hooks/use-sheet-tape'
import { formatProvisional, formatRounded } from '../../../lib/tape-format'
import { spreadLabels } from './label-spread'

export type MeasureLayerReview = Pick<
  DocumentReview,
  'annotations' | 'selectedId' | 'select' | 'tape'
>

const share = (
  element: HTMLElement,
  event: { clientX: number; clientY: number }
): PagePoint | null => {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return [
    clamp((event.clientX - rect.left) / rect.width),
    clamp((event.clientY - rect.top) / rect.height),
  ]
}

const override = (event: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  event.ctrlKey || event.metaKey

const px = (points: readonly PagePoint[], size: PageSize): MeasureMarkPoint[] =>
  points.map(([x, y]) => [x * size.width, y * size.height] as const)

export const isKeptMeasure = (annotation: AnnotationView): boolean =>
  isMeasureShape(annotation.shape) && (annotation.points?.length ?? 0) >= 2

function keptValue(
  annotation: AnnotationView,
  t: ReturnType<typeof useTranslations>,
  locale: string
): string | null {
  const rounded = annotation.reading ? formatRounded(annotation.reading, locale) : null
  const body = annotation.body.trim()
  const named =
    body &&
    !(['line', 'path', 'polygon'] as const).some(
      (shape) => t(`review.measure.shape.${shape}`) === body
    )
      ? body
      : null
  return rounded && named
    ? `${named.length > 28 ? `${named.slice(0, 27)}…` : named} · ${rounded}`
    : rounded
}

function KeptMeasure({
  annotation,
  size,
  value,
  at: [x, y],
  selected,
  onSelect,
  passThrough,
}: {
  annotation: AnnotationView
  size: PageSize
  value: string | null
  at: readonly [number, number]
  selected: boolean
  onSelect: () => void
  passThrough: boolean
}): JSX.Element {
  const t = useTranslations(filesCopy)
  const points = px(annotation.points ?? [], size)
  const closed = annotation.shape === 'polygon'
  return (
    <>
      <svg
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
      >
        <MeasureLine
          points={points}
          closed={closed}
          surface="paper"
          data-selected={selected || undefined}
        />
        {(annotation.shape === 'line' ? [points[0], points[points.length - 1]] : points).map(
          (at, index) => (
            <MeasureEnd key={index} at={at} kind="vertex" surface="paper" />
          )
        )}
      </svg>
      {value && (
        <button
          type="button"
          data-testid={`measure-kept-${annotation.id}`}
          aria-pressed={selected}
          aria-label={t('review.measure.kept', { number: annotation.number, value: value ?? '' })}
          onClick={onSelect}
          className={cn(
            MEASURE_LABEL_AT_CLASS,
            measureLabelClass('paper'),
            'focus-visible:ring-ring/60 z-30 outline-none focus-visible:ring-2',
            "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-3.5 pointer-coarse:after:content-['']",
            passThrough ? 'pointer-events-none' : 'pointer-events-auto',
            selected && 'bg-paper-ink text-paper-ink-foreground'
          )}
          style={{ left: x, top: y }}
        >
          {value}
        </button>
      )}
    </>
  )
}

export function MeasureLayer({
  review,
  page,
  focused,
  size,
  blocked = false,
}: {
  review: MeasureLayerReview
  page: number
  focused: boolean
  size: PageSize
  blocked?: boolean
}): JSX.Element | null {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const { annotations, selectedId, select, tape } = review
  const kept = annotations.filter(
    (annotation) =>
      annotation.page === page &&
      annotation.onCurrentRevision &&
      isKeptMeasure(annotation) &&
      (isLive(annotation) || annotation.id === selectedId)
  )
  const active = focused && tape.active
  if ((!active && kept.length === 0) || size.width <= 0) return null
  const here = active && tape.page === page
  const hover = active && tape.hover?.page === page ? tape.hover : null
  const placing = tape.phase === 'placing'
  const trail = here ? [...tape.points, ...(hover && placing ? [hover.at] : [])] : []
  const closed = TAPE_SHAPE[tape.mode] === 'polygon' && trail.length >= 3
  const shown = px(trail, size)
  const [lx, ly] = labelAnchor(shown, closed)
  const engineValue = here && tape.reading ? formatRounded(tape.reading, locale) : null
  const provisional =
    here && !engineValue && tape.provisional
      ? formatProvisional(tape.provisional.value, tape.provisional.unit, locale)
      : null

  const unscaled = tape.unscaled(page)
  const [first] = tape.points
  const closing =
    hover !== null &&
    placing &&
    tape.mode === 'area' &&
    tape.points.length >= 3 &&
    Math.hypot((hover.at[0] - first[0]) * size.width, (hover.at[1] - first[1]) * size.height) <= 10
  const keptLabels = spreadLabels(
    (engineValue || provisional) && shown.length >= 2
      ? [{ x: lx, y: ly, text: `≈ ${engineValue ?? provisional}` }]
      : [],
    kept.map((annotation) => {
      const [x, y] = labelAnchor(px(annotation.points ?? [], size), annotation.shape === 'polygon')
      return { x, y, text: keptValue(annotation, t, locale) ?? '' }
    })
  )
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) =>
    tape.pointer(page, share(event.currentTarget, event), size, override(event))
  return (
    <div className="pointer-events-none absolute inset-0" data-testid={`measure-layer-${page}`}>
      {active && !blocked && (
        <div
          aria-hidden
          data-testid={`measure-capture-${page}`}
          data-zoom-tap="off"
          className={cn(
            'pointer-events-auto absolute inset-0 z-10',
            unscaled ? 'cursor-not-allowed' : 'cursor-crosshair'
          )}
          onPointerMove={onMove}
          onPointerLeave={() => tape.pointer(page, null, size)}
          onClick={(event) => {
            const at = share(event.currentTarget, event)
            if (!at) return
            select(null)
            tape.add(page, at, size, override(event))
          }}
          onDoubleClick={() => tape.finish()}
        />
      )}
      {kept.map((annotation, index) => (
        <KeptMeasure
          key={annotation.id}
          annotation={annotation}
          size={size}
          value={keptLabels[index].text || null}
          at={[keptLabels[index].x, keptLabels[index].y]}
          selected={annotation.id === selectedId}
          onSelect={() => select(annotation.id === selectedId ? null : annotation.id)}
          passThrough={active && !blocked && tape.points.length > 0}
        />
      ))}
      {(here || hover) && (
        <svg
          aria-hidden
          className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
          data-testid="measure-in-hand"
        >
          <MeasureLine points={shown} closed={closed} placing surface="paper" />
          {here &&
            px(tape.points, size).map((at, index) => (
              <MeasureEnd
                key={index}
                at={at}
                kind={tape.kinds[index] ?? 'free'}
                surface="paper"
                data-testid="measure-point"
              />
            ))}
          {hover && placing && (
            <MeasureEnd
              at={px([hover.at], size)[0]}
              kind={hover.kind}
              surface="paper"
              data-testid="measure-hover"
            />
          )}
        </svg>
      )}
      {hover && placing && (closing || hover.kind !== 'free') && (
        <span
          aria-hidden
          data-testid="measure-snap-tag"
          className={cn(
            measureLabelClass('paper'),
            'text-meta pointer-events-none absolute z-30 -translate-y-full px-1.5 py-0'
          )}
          style={{ left: hover.at[0] * size.width + 10, top: hover.at[1] * size.height - 8 }}
        >
          {closing ? t('review.measure.closeArea') : t(`review.measure.snapped.${hover.kind === 'free' ? 'vertex' : hover.kind}`)}
        </span>
      )}
      {(engineValue || provisional) && shown.length >= 2 && (
        <MeasureLabel
          x={lx}
          y={ly}
          surface="paper"
          provisional={!engineValue}
          className="z-30"
          data-testid={engineValue ? 'measure-value' : 'measure-provisional'}
          aria-label={
            provisional ? t('review.measure.provisionalLabel', { value: provisional }) : undefined
          }
        >
          {engineValue ?? provisional}
        </MeasureLabel>
      )}
    </div>
  )
}
