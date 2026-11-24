'use client'

import {
  useEffect,
  useRef,
  useState,
  type JSX,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { useLocale, useTranslations } from '@/i18n'
import { filesCopy } from '@/i18n/namespaces/files'
import {
  MEASURE_MARKER,
  MEASURE_STROKE,
  MEASURE_SURFACE,
  measureMarkerPath,
  measureLabelClass,
  type MeasureMarkKind,
} from '@/components/ui/measure-mark-recipe'
import { formatMetres } from '@/lib/format'
import { regionBetween, type PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import type { CalibrationPoint, CalibrationRegion } from '@/lib/drawing-calibrations/wire'
import { cn } from '@/lib/utils'
import type { ReviewCalibration } from '../../hooks/use-review-calibration'
import type { DraftEnd } from '../../lib/calibration-draft'
import { at, box, pointIn } from '../../lib/review-overlay-geometry'

const MIN_REGION = 0.012
const POINT_SLOP = 8

export const MEASURE_LABEL =
  'bg-sheet text-foreground shadow-xs pointer-events-none absolute rounded-full px-1.5 text-meta font-medium whitespace-nowrap tabular-nums'

export function usePageSizePt(ref: RefObject<HTMLElement | null>): PageSizePt | null {
  const [size, setSize] = useState<PageSizePt | null>(null)
  useEffect(() => {
    const sheet = ref.current?.closest<HTMLElement>('[data-page]')
    if (!sheet) return
    const read = () => {
      const width = Number(sheet.dataset.pageWidthPt)
      const height = Number(sheet.dataset.pageHeightPt)
      const known = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
      setSize((held) =>
        !known ? null : held?.width === width && held.height === height ? held : { width, height }
      )
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(sheet, {
      attributes: true,
      attributeFilter: ['data-page-width-pt', 'data-page-height-pt'],
    })
    return () => observer.disconnect()
  }, [ref])
  return size
}

const pct = (share: number) => `${share * 100}%`

function SpanLine({
  from,
  to,
  placing,
}: {
  from: CalibrationPoint
  to: CalibrationPoint
  placing: boolean
}): JSX.Element {
  const ends = { x1: pct(from.x), y1: pct(from.y), x2: pct(to.x), y2: pct(to.y) }
  const dash = placing ? MEASURE_STROKE.placingDash : undefined
  return (
    <>
      <line
        {...ends}
        stroke={MEASURE_SURFACE.paper.halo}
        strokeWidth={MEASURE_STROKE.haloWidth}
        strokeLinecap="round"
        strokeDasharray={dash}
      />
      <line
        {...ends}
        stroke={MEASURE_SURFACE.paper.ink}
        strokeWidth={MEASURE_STROKE.lineWidth}
        strokeLinecap="round"
        strokeDasharray={dash}
      />
    </>
  )
}

function EndMarker({
  point,
  testId,
  kind = 'vertex',
}: {
  point: CalibrationPoint
  testId: string
  kind?: MeasureMarkKind
}): JSX.Element {
  return (
    <svg x={pct(point.x)} y={pct(point.y)} overflow="visible" data-testid={testId}>
      <path
        d={measureMarkerPath(kind)}
        fill={MEASURE_SURFACE.paper.halo}
        stroke={MEASURE_SURFACE.paper.ink}
        strokeWidth={MEASURE_MARKER.strokeWidth}
      />
    </svg>
  )
}

export function ScaleRegion({
  region,
  label,
  tone = 'quiet',
  testId,
  draftPart,
}: {
  region: CalibrationRegion
  label?: string | null
  tone?: 'quiet' | 'emphasis' | 'draft' | 'refused'
  testId?: string
  draftPart?: boolean
}): JSX.Element {
  return (
    <span
      data-testid={testId}
      data-draft-part={draftPart ? 'frame' : undefined}
      data-tone={tone}
      className={cn(
        'pointer-events-none absolute',
        tone === 'quiet' && 'border-paper-ink/45 border border-dashed',
        tone === 'emphasis' && 'border-paper-ink bg-paper-ink/5 border-[1.5px]',
        tone === 'draft' && 'border-paper-ink border-[1.5px] border-dashed',
        tone === 'refused' && 'border-error border-[1.5px] border-dashed'
      )}
      style={box(region.x, region.y, region.w, region.h)}
    >
      {label && (
        <span
          className={cn(
            MEASURE_LABEL,
            draftPart ? 'bottom-0 left-2 translate-y-1/2' : 'top-0 left-2 -translate-y-1/2'
          )}
        >
          {label}
        </span>
      )}
    </span>
  )
}

export function CalibrationPageLayer({
  page,
  calibration,
}: {
  page: number
  calibration: ReviewCalibration
}): JSX.Element | null {
  return calibration.shown ? <ShownLayer page={page} calibration={calibration} /> : null
}

type Press = {
  pointers: Set<number>
  start: { point: CalibrationPoint; clientX: number; clientY: number } | null
  cancelled: boolean
}

function EndHandle({
  end,
  point,
  page,
  layer,
  calibration,
}: {
  end: DraftEnd
  page: number
  point: CalibrationPoint
  layer: RefObject<HTMLDivElement | null>
  calibration: ReviewCalibration
}): JSX.Element {
  const [grab, setGrab] = useState<CalibrationPoint | null>(null)
  const dragging = grab !== null
  const move = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const surface = layer.current
    const finger = grab && surface ? pointIn(surface, event) : null
    if (!grab || !finger || !surface) return
    const rect = surface.getBoundingClientRect()
    const found = calibration.snap(page, [finger.x - grab.x, finger.y - grab.y], {
      width: rect.width,
      height: rect.height,
    })
    calibration.movePoint(end, { x: found.at[0], y: found.at[1] })
  }
  const stop = () => setGrab(null)
  return (
    <span
      data-testid={`calibration-handle-${end}`}
      data-draft-part="end"
      data-dragging={dragging || undefined}
      className={cn(
        'pointer-events-auto absolute z-30 size-5 -translate-x-1/2 -translate-y-1/2 cursor-move touch-none rounded-full pointer-coarse:size-11',
        dragging && 'ring-paper-ink/70 ring-2'
      )}
      style={at(point.x, point.y)}
      onPointerDown={(event) => {
        const finger = layer.current ? pointIn(layer.current, event) : null
        if (event.button !== 0 || !finger) return
        event.preventDefault()
        event.stopPropagation()
        event.currentTarget.setPointerCapture?.(event.pointerId)
        setGrab({ x: finger.x - point.x, y: finger.y - point.y })
      }}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
    />
  )
}

function ShownLayer({
  page,
  calibration,
}: {
  page: number
  calibration: ReviewCalibration
}): JSX.Element {
  const { locale } = useLocale()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const pageSize = usePageSizePt(layerRef)
  const [drag, setDrag] = useState<{ a: CalibrationPoint; b: CalibrationPoint } | null>(null)
  const [cursor, setCursor] = useState<{ point: CalibrationPoint; kind: MeasureMarkKind } | null>(
    null
  )
  const t = useTranslations(filesCopy)
  const press = useRef<Press>({ pointers: new Set(), start: null, cancelled: false })
  const { reportPageSize, draft, proposal, setting, open, hoveredId, lengthM, step, measuring } =
    calibration
  useEffect(() => {
    if (pageSize) reportPageSize(page, pageSize)
  }, [page, pageSize, reportPageSize])

  const here = draft && (draft.page === page || !draft.from) ? draft : null
  const { draftLayer } = calibration
  useEffect(() => {
    const layer = layerRef.current
    if (!here?.to || !layer) return
    draftLayer.current = layer
    return () => {
      if (draftLayer.current === layer) draftLayer.current = null
    }
  }, [here?.to, draftLayer])
  const drawsRegion = Boolean(here?.from && here.to) && (step === 'region' || step === 'review')
  const grabbable = setting && step !== 'region'

  const snapped = (surface: HTMLElement, point: CalibrationPoint) => {
    const rect = surface.getBoundingClientRect()
    const found = calibration.snap(page, [point.x, point.y], {
      width: rect.width,
      height: rect.height,
    })
    return { point: { x: found.at[0], y: found.at[1] }, kind: found.kind }
  }
  useEffect(() => {
    if (setting) calibration.loadSnap(page)
  }, [setting, page, calibration])

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const held = press.current
    held.pointers.add(event.pointerId)
    if (held.pointers.size > 1) {
      held.cancelled = true
      setDrag(null)
      return
    }
    const point = pointIn(event.currentTarget, event)
    if (!point) return
    held.cancelled = false
    held.start = { point, clientX: event.clientX, clientY: event.clientY }
    event.currentTarget.setPointerCapture?.(event.pointerId)
    if (drawsRegion) setDrag({ a: point, b: point })
  }
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const point = pointIn(event.currentTarget, event)
    if (!point) return
    if (drag && !press.current.cancelled) setDrag({ ...drag, b: point })
    else if (event.pointerType !== 'touch' && (!here || !here.to) && !drawsRegion)
      setCursor(snapped(event.currentTarget, point))
  }
  const onPointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = press.current
    held.pointers.delete(event.pointerId)
    if (held.pointers.size > 0) return
    const { start } = held
    const cancelled = held.cancelled || event.type === 'pointercancel'
    held.start = null
    held.cancelled = false
    const dragged = drag
    setDrag(null)
    if (cancelled || !start) return
    if (dragged) {
      const region = regionBetween(dragged.a, dragged.b)
      if (region && region.w >= MIN_REGION && region.h >= MIN_REGION)
        calibration.drawRegion(page, region)
      return
    }
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > POINT_SLOP)
      return
    calibration.pick(page, snapped(event.currentTarget, start.point).point)
    setCursor(null)
  }

  const scales = calibration.onPage(page)
  const several = scales.length > 1
  const framed = scales.filter((entry) => entry.scope === 'page' || entry.id === hoveredId)
  const saved = open || setting || (measuring && several) ? framed : []
  const dragRegion = drag ? regionBetween(drag.a, drag.b) : null
  const draftRegion = dragRegion ?? here?.region ?? null
  const refused = !dragRegion && proposal.blocked === 'overlaps'
  const span = here?.from ? { from: here.from, to: here.to ?? cursor?.point ?? null } : null
  const length = here?.to && lengthM !== null ? formatMetres(lengthM, locale) : null

  return (
    <div
      ref={layerRef}
      className="pointer-events-none absolute inset-0"
      data-testid={`calibration-layer-${page}`}
    >
      {setting && (
        <div
          data-testid="calibration-capture"
          data-calibration-capture
          aria-hidden
          data-zoom-tap="off"
          className={cn(
            'pointer-events-auto absolute inset-0 z-20 cursor-crosshair',
            drawsRegion ? 'touch-none' : 'touch-pan-x touch-pan-y touch-pinch-zoom'
          )}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerLeave={() => setCursor(null)}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        />
      )}
      {saved.map((entry) => {
        const emphasis = hoveredId === entry.id || proposal.overlaps?.id === entry.id
        return (
          <ScaleRegion
            key={entry.id}
            testId={`calibration-region-${entry.id}`}
            region={entry.region}
            label={emphasis || several ? calibration.ratioOf(entry) : null}
            tone={emphasis ? 'emphasis' : 'quiet'}
          />
        )
      })}
      {draftRegion && (
        <ScaleRegion
          testId="calibration-draft-region"
          draftPart
          region={draftRegion}
          label={dragRegion ? null : proposal.ratio}
          tone={refused ? 'refused' : 'draft'}
        />
      )}
      {span && (
        <svg
          aria-hidden
          className="absolute inset-0 z-20 size-full overflow-visible"
          data-testid="calibration-span"
        >
          {span.to && <SpanLine from={span.from} to={span.to} placing={!here?.to} />}
          <EndMarker point={span.from} testId="calibration-point-from" />
          {here?.to && <EndMarker point={here.to} testId="calibration-point-to" />}
        </svg>
      )}
      {cursor && setting && !here?.to && (
        <>
          <svg aria-hidden className="absolute inset-0 z-20 size-full overflow-visible">
            <EndMarker point={cursor.point} kind={cursor.kind} testId="calibration-hover" />
          </svg>
          {cursor.kind !== 'free' && (
            <span
              aria-hidden
              data-testid="calibration-snap-tag"
              className={cn(
                measureLabelClass('paper'),
                'text-meta pointer-events-none absolute z-30 -translate-y-full px-1.5 py-0'
              )}
              style={{
                left: `calc(${pct(cursor.point.x)} + 10px)`,
                top: `calc(${pct(cursor.point.y)} - 8px)`,
              }}
            >
              {t(`review.measure.snapped.${cursor.kind}`)}
            </span>
          )}
        </>
      )}
      {grabbable && here?.from && (
        <EndHandle
          end="from"
          page={page}
          point={here.from}
          layer={layerRef}
          calibration={calibration}
        />
      )}
      {grabbable && here?.to && (
        <EndHandle
          end="to"
          page={page}
          point={here.to}
          layer={layerRef}
          calibration={calibration}
        />
      )}
      {span?.to && length && (
        <span
          data-testid="calibration-span-length"
          className={cn(MEASURE_LABEL, 'z-20 -translate-x-1/2 -translate-y-1/2')}
          style={at((span.from.x + span.to.x) / 2, (span.from.y + span.to.y) / 2)}
        >
          {length}
        </span>
      )}
    </div>
  )
}
