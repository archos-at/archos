'use client'

import { useEffect, useRef, useState, type JSX, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { useLocale } from '@/i18n'
import { MEASURE_MARKER, MEASURE_STROKE, measureMarkerPath } from '@/components/ui/measure-mark-recipe'
import { formatMetres } from '@/lib/format'
import { regionBetween, type PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import type { CalibrationPoint, CalibrationRegion } from '@/lib/drawing-calibrations/wire'
import { cn } from '@/lib/utils'
import type { ReviewCalibration } from '../../hooks/use-review-calibration'
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
      setSize((held) => (!known ? null : held?.width === width && held.height === height ? held : { width, height }))
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(sheet, { attributes: true, attributeFilter: ['data-page-width-pt', 'data-page-height-pt'] })
    return () => observer.disconnect()
  }, [ref])
  return size
}

const pct = (share: number) => `${share * 100}%`

function SpanLine({ from, to, placing }: { from: CalibrationPoint; to: CalibrationPoint; placing: boolean }): JSX.Element {
  const ends = { x1: pct(from.x), y1: pct(from.y), x2: pct(to.x), y2: pct(to.y) }
  const dash = placing ? MEASURE_STROKE.dash : undefined
  return (
    <>
      <line {...ends} stroke={MEASURE_STROKE.haloColor} strokeWidth={MEASURE_STROKE.halo} strokeLinecap="round" strokeDasharray={dash} />
      <line {...ends} stroke={MEASURE_STROKE.lineColor} strokeWidth={MEASURE_STROKE.line} strokeLinecap="round" strokeDasharray={dash} />
    </>
  )
}

function EndMarker({ point, testId }: { point: CalibrationPoint; testId: string }): JSX.Element {
  return (
    <svg x={pct(point.x)} y={pct(point.y)} overflow="visible" data-testid={testId}>
      <path d={measureMarkerPath('square')} fill={MEASURE_MARKER.fill} stroke={MEASURE_MARKER.stroke} strokeWidth={MEASURE_MARKER.strokeWidth} />
    </svg>
  )
}

export function ScaleRegion({
  region,
  label,
  tone = 'quiet',
  testId,
}: {
  region: CalibrationRegion
  label?: string | null
  tone?: 'quiet' | 'emphasis' | 'draft' | 'refused'
  testId?: string
}): JSX.Element {
  return (
    <span
      data-testid={testId}
      data-tone={tone}
      className={cn(
        'pointer-events-none absolute',
        tone === 'quiet' && 'border-foreground/40 border',
        tone === 'emphasis' && 'border-foreground bg-foreground/5 border-[1.5px]',
        tone === 'draft' && 'border-foreground border-[1.5px] border-dashed',
        tone === 'refused' && 'border-error border-[1.5px] border-dashed'
      )}
      style={box(region.x, region.y, region.w, region.h)}
    >
      {label && <span className={cn(MEASURE_LABEL, 'top-0 left-2 -translate-y-1/2')}>{label}</span>}
    </span>
  )
}

export function CalibrationPageLayer({ page, calibration }: { page: number; calibration: ReviewCalibration }): JSX.Element | null {
  return calibration.shown ? <ShownLayer page={page} calibration={calibration} /> : null
}

type Press = { pointers: Set<number>; start: { point: CalibrationPoint; clientX: number; clientY: number } | null; cancelled: boolean }

function ShownLayer({ page, calibration }: { page: number; calibration: ReviewCalibration }): JSX.Element {
  const { locale } = useLocale()
  const layerRef = useRef<HTMLDivElement | null>(null)
  const pageSize = usePageSizePt(layerRef)
  const [drag, setDrag] = useState<{ a: CalibrationPoint; b: CalibrationPoint } | null>(null)
  const [cursor, setCursor] = useState<CalibrationPoint | null>(null)
  const press = useRef<Press>({ pointers: new Set(), start: null, cancelled: false })
  const { reportPageSize, draft, proposal, setting, open, hoveredId, lengthM } = calibration
  useEffect(() => {
    if (pageSize) reportPageSize(page, pageSize)
  }, [page, pageSize, reportPageSize])

  const here = draft && (draft.page === page || !draft.from) ? draft : null
  const drawsRegion = Boolean(here?.from && here.to)

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
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
    else if (event.pointerType !== 'touch' && here?.from && !here.to) setCursor(point)
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
      if (region && region.w >= MIN_REGION && region.h >= MIN_REGION) calibration.drawRegion(page, region)
      return
    }
    if (Math.hypot(event.clientX - start.clientX, event.clientY - start.clientY) > POINT_SLOP) return
    calibration.pick(page, start.point)
    setCursor(null)
  }

  const saved = open || setting ? calibration.onPage(page) : []
  const dragRegion = drag ? regionBetween(drag.a, drag.b) : null
  const draftRegion = dragRegion ?? here?.region ?? null
  const refused = !dragRegion && proposal.blocked === 'overlaps'
  const span = here?.from ? { from: here.from, to: here.to ?? cursor } : null
  const length = here?.to && lengthM !== null ? formatMetres(lengthM, locale) : null

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0" data-testid={`calibration-layer-${page}`}>
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
            label={emphasis ? calibration.ratioOf(entry) : null}
            tone={emphasis ? 'emphasis' : 'quiet'}
          />
        )
      })}
      {draftRegion && (
        <ScaleRegion
          testId="calibration-draft-region"
          region={draftRegion}
          label={dragRegion ? null : proposal.ratio}
          tone={refused ? 'refused' : 'draft'}
        />
      )}
      {span && (
        <svg aria-hidden className="absolute inset-0 z-20 size-full overflow-visible" data-testid="calibration-span">
          {span.to && <SpanLine from={span.from} to={span.to} placing={!here?.to} />}
          <EndMarker point={span.from} testId="calibration-point-from" />
          {here?.to && <EndMarker point={here.to} testId="calibration-point-to" />}
        </svg>
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
