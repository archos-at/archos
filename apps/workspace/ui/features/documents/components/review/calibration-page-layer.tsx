'use client'

/**
 * A page's scale calibrations, drawn on the page: each active one as the region
 * it holds for with its ratio, and the one being set (two reference points,
 * the span between them, the region being drawn).
 *
 * With the `calibrate` tool in hand the layer is also the surface the tool
 * works on: a click sets the first point, the next the second; with both set,
 * a drag draws the region, unless the file stores one that holds both points.
 * Every place leaves here as a share of the page (0 to 1, origin top left).
 *
 * The page's size in points comes from the viewer's page element
 * (`data-page-width-pt` and `data-page-height-pt` on `[data-page]`,
 * `pdf-page-canvas.tsx`): a calibration stores no scale, so the ratio shown is
 * computed from the page as it is rendered.
 */

import { useEffect, useRef, useState, type CSSProperties, type JSX, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import { calibrationRatio, regionBetween, type PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import type { CalibrationPoint, CalibrationRegion } from '@/lib/drawing-calibrations/wire'
import { formatDecimalInput } from '@/lib/text/parse-decimal'
import { cn } from '@/lib/utils'
import type { ReviewCalibration } from '../../hooks/use-review-calibration'

/** A box narrower or lower than this share of the page was a slipped click, not a region. */
const MIN_REGION = 0.012
/** How far a press may travel, in CSS pixels, and still set a point where it began (the mark tools' figure). */
const POINT_SLOP = 8

const share = (value: number) => `${value * 100}%`
const at = (point: CalibrationPoint): CSSProperties => ({ left: share(point.x), top: share(point.y) })
const boxOf = (region: CalibrationRegion): CSSProperties => ({
  left: share(region.x),
  top: share(region.y),
  width: share(region.w),
  height: share(region.h),
})

/** The size in points of the page an element lies on, as the viewer states it; null until the page has rendered. */
export function usePageSizePt(ref: RefObject<HTMLElement | null>): PageSizePt | null {
  const [size, setSize] = useState<PageSizePt | null>(null)
  useEffect(() => {
    const sheet = ref.current?.closest<HTMLElement>('[data-page]')
    if (!sheet) return
    const read = () => {
      const width = Number(sheet.dataset.pageWidthPt)
      const height = Number(sheet.dataset.pageHeightPt)
      const known = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      setSize((held) => (!known ? null : held?.width === width && held.height === height ? held : { width, height }))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(sheet, { attributes: true, attributeFilter: ['data-page-width-pt', 'data-page-height-pt'] })
    return () => observer.disconnect()
  }, [ref])
  return size
}

/** The region a scale holds for, outlined on the page, with what it says on its upper edge. */
export function ScaleRegionBox({
  region,
  label,
  emphasis = false,
  pending = false,
  testId,
}: {
  region: CalibrationRegion
  /** The ratio, „1:100“; none while it is not known yet. */
  label?: string | null
  /** The one a row beside the page points at. */
  emphasis?: boolean
  /** Being set, not yet saved: dashed, as a draft is. */
  pending?: boolean
  testId?: string
}): JSX.Element {
  // The tag sits above the box; at the page's upper edge it has no room there and sits inside.
  const inside = region.y < 0.04
  return (
    <span
      data-testid={testId}
      data-slot="scale-region"
      className={cn(
        'border-foreground/70 absolute rounded-[2px] border',
        pending && 'border-dashed',
        emphasis && 'border-foreground bg-foreground/5 border-2'
      )}
      style={boxOf(region)}
    >
      {label && (
        <span
          className={cn(
            'bg-foreground text-background absolute left-0 px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap tabular-nums',
            inside ? 'top-0 rounded-br-sm' : 'top-0 -translate-y-full rounded-t-sm'
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}

/** A reference point: a dot in ink with a paper ring, legible on linework of any colour. */
function ReferencePoint({ point, testId }: { point: CalibrationPoint; testId?: string }): JSX.Element {
  return (
    <span
      data-testid={testId}
      data-slot="reference-point"
      className="bg-foreground ring-background absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2"
      style={at(point)}
    />
  )
}

/**
 * The span between two reference points, with its true length under its middle
 * once that is typed: under, because a printed dimension figure stands over its line.
 */
export function ReferenceSpan({
  from,
  to,
  label,
}: {
  from: CalibrationPoint
  to: CalibrationPoint | null
  label?: string | null
}): JSX.Element {
  return (
    <>
      {to && (
        <svg aria-hidden className="absolute inset-0 size-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* A paper halo under the ink: the span stays readable across dark linework. */}
          <line x1={from.x * 100} y1={from.y * 100} x2={to.x * 100} y2={to.y * 100} className="stroke-background" strokeWidth={4} vectorEffect="non-scaling-stroke" />
          <line x1={from.x * 100} y1={from.y * 100} x2={to.x * 100} y2={to.y * 100} className="stroke-foreground" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
      )}
      <ReferencePoint point={from} testId="calibration-point-from" />
      {to && <ReferencePoint point={to} testId="calibration-point-to" />}
      {to && label && (
        <span
          data-testid="calibration-span-length"
          className="border-foreground/20 bg-popover text-foreground absolute -translate-x-1/2 translate-y-2 rounded-sm border px-1.5 py-0.5 text-[11px] leading-none font-medium whitespace-nowrap tabular-nums shadow-sm"
          style={at({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 })}
        >
          {label}
        </span>
      )}
    </>
  )
}

/** The point on an element an event hit, as shares of it, clamped onto it. */
function pointIn(element: HTMLElement, event: { clientX: number; clientY: number }): CalibrationPoint | null {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  const clamp = (value: number) => Math.min(1, Math.max(0, value))
  return { x: clamp((event.clientX - rect.left) / rect.width), y: clamp((event.clientY - rect.top) / rect.height) }
}

/** Nothing where the organization does not hold `drawing-measure`, or the list has not answered. */
export function CalibrationPageLayer({ page, calibration }: { page: number; calibration: ReviewCalibration }): JSX.Element | null {
  return calibration.shown ? <ShownPageLayer page={page} calibration={calibration} /> : null
}

function ShownPageLayer({ page, calibration }: { page: number; calibration: ReviewCalibration }): JSX.Element {
  const t = useTranslations(filesCopy)
  const { locale } = useLocale()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const pageSize = usePageSizePt(layerRef)
  const [drag, setDrag] = useState<{ a: CalibrationPoint; b: CalibrationPoint } | null>(null)
  const press = useRef<{ pointers: Set<number>; start: (CalibrationPoint & { clientX: number; clientY: number }) | null; cancelled: boolean }>({
    pointers: new Set(),
    start: null,
    cancelled: false,
  })
  const { reportPageSize, draft, proposal, active, open, hoveredId } = calibration
  useEffect(() => {
    if (pageSize) reportPageSize(page, pageSize)
  }, [page, pageSize, reportPageSize])

  const here = draft?.page === page ? draft : null
  const bothSet = Boolean(here?.to)
  // A stored region that holds both points is taken: there is nothing to draw.
  const drawsRegion = bothSet && proposal.regionSource !== 'stored'

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const held = press.current
    held.pointers.add(event.pointerId)
    // A second finger: a pinch, not a point.
    if (held.pointers.size > 1) {
      held.cancelled = true
      setDrag(null)
      return
    }
    const point = pointIn(event.currentTarget, event)
    if (!point) return
    held.cancelled = false
    held.start = { ...point, clientX: event.clientX, clientY: event.clientY }
    event.currentTarget.setPointerCapture(event.pointerId)
    if (drawsRegion) setDrag({ a: point, b: point })
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag || press.current.cancelled) return
    const point = pointIn(event.currentTarget, event)
    if (point) setDrag({ ...drag, b: point })
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = press.current
    held.pointers.delete(event.pointerId)
    if (held.pointers.size > 0) return
    const start = held.start
    const cancelled = held.cancelled || event.type === 'pointercancel'
    held.start = null
    held.cancelled = false
    const dragged = drag
    setDrag(null)
    if (cancelled || !start) return
    if (dragged) {
      const region = regionBetween(dragged.a, dragged.b)
      if (region && region.w >= MIN_REGION && region.h >= MIN_REGION) calibration.drawRegion(page, region)
      return
    }
    // A press that travelled was a pan that landed on the page, not a point.
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > POINT_SLOP) return
    if (pageSize) calibration.pick(page, { x: start.x, y: start.y }, pageSize)
  }

  const saved = open ? calibration.onPage(page) : []
  const dragRegion = drag ? regionBetween(drag.a, drag.b) : null
  const draftRegion = dragRegion ?? (here ? (proposal.region ?? here.drawn) : null)
  const length = here?.lengthM != null ? t('review.calibrate.metres', { value: formatDecimalInput(here.lengthM, locale) }) : null

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0" data-testid={`calibration-layer-${page}`}>
      {active && (
        <div
          data-testid="calibration-capture"
          aria-hidden
          // A double tap here sets the second point, it is not a zoom.
          data-zoom-tap="off"
          className="pointer-events-auto absolute inset-0 z-10 cursor-crosshair touch-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
      )}
      {saved.map((entry) => (
        <ScaleRegionBox
          key={entry.id}
          testId={`calibration-region-${entry.id}`}
          region={entry.region}
          label={pageSize ? calibrationRatio(entry, pageSize) : null}
          emphasis={hoveredId === entry.id}
        />
      ))}
      {draftRegion && <ScaleRegionBox testId="calibration-draft-region" region={draftRegion} label={dragRegion ? null : proposal.ratio} pending />}
      {here && <ReferenceSpan from={here.from} to={here.to} label={length} />}
    </div>
  )
}
