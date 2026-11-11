import type { ComponentProps, CSSProperties, JSX } from 'react'
import type { PagePoint } from '@/lib/annotations/measure-shapes'
import { cn } from '@/lib/utils'

/**
 * The atoms a measurement is drawn with on a page: the line through its
 * points, a dot on each, and a place to hang something beside it. Places are
 * shares of the page (origin top left), so a shape keeps its place at any zoom.
 *
 * Drawn in the sheet's own ink (`--paper-ink`), like the frame a person drags
 * for a comment: a measurement is a mark on paper, never a signal colour. In
 * hand it is dashed (not kept yet); kept it is solid.
 */

const INK = 'var(--paper-ink)'
export const sheetPlace = ([x, y]: PagePoint | readonly [number, number]): CSSProperties => ({
  left: `${x * 100}%`,
  top: `${y * 100}%`,
})

/** The line through the points; closed and faintly filled for an area. */
export function SheetShape({
  points,
  closed = false,
  kept = false,
  selected = false,
  ...props
}: {
  points: readonly PagePoint[]
  closed?: boolean
  /** Kept on the sheet (solid) rather than in hand (dashed). */
  kept?: boolean
  selected?: boolean
} & Omit<ComponentProps<'svg'>, 'points'>): JSX.Element | null {
  if (points.length < 2) return null
  const path = points.map(([x, y]) => `${x * 100},${y * 100}`).join(' ')
  const stroke = { stroke: INK, strokeWidth: selected ? 2.5 : 1.5, vectorEffect: 'non-scaling-stroke' as const }
  return (
    <svg
      aria-hidden
      data-slot="sheet-shape"
      data-kept={kept || undefined}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 z-20 size-full overflow-visible"
      {...props}
    >
      {closed ? (
        <polygon points={path} fill={INK} fillOpacity={0.08} strokeDasharray={kept ? undefined : '5 4'} {...stroke} />
      ) : (
        <polyline points={path} fill="none" strokeDasharray={kept ? undefined : '5 4'} {...stroke} />
      )}
    </svg>
  )
}

/** A point of a measurement: a small ring on the corner the engine tied it to. */
export function SheetDot({ at, className, ...props }: { at: PagePoint } & ComponentProps<'span'>): JSX.Element {
  return (
    <span
      aria-hidden
      data-slot="sheet-dot"
      className={cn(
        'border-paper-ink bg-sheet pointer-events-none absolute z-20 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px]',
        className
      )}
      style={sheetPlace(at)}
      {...props}
    />
  )
}

/** A corner the engine offers where several are in reach: a target a person picks. */
export function SheetCandidate({ at, className, ...props }: { at: PagePoint } & ComponentProps<'button'>): JSX.Element {
  return (
    <button
      type="button"
      data-slot="sheet-candidate"
      className={cn(
        'border-paper-ink bg-sheet pointer-events-auto absolute z-30 size-4 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2',
        'hover:bg-paper-ink focus-visible:ring-ring/60 outline-none focus-visible:ring-2 pointer-coarse:size-6',
        className
      )}
      style={sheetPlace(at)}
      {...props}
    />
  )
}

/** Something hung beside a place on the sheet (a reading, a note): right of it, or left where the page ends. */
export function SheetAnchor({ at, className, ...props }: { at: PagePoint } & ComponentProps<'div'>): JSX.Element {
  const left = at[0] > 0.6
  const above = at[1] > 0.7
  return (
    <div
      data-slot="sheet-anchor"
      data-side={left ? 'left' : 'right'}
      className={cn(
        'pointer-events-auto absolute z-30',
        left ? '-translate-x-[calc(100%+12px)]' : 'translate-x-3',
        above ? '-translate-y-[calc(100%+12px)]' : 'translate-y-3',
        className
      )}
      style={sheetPlace(at)}
      {...props}
    />
  )
}

/** A kept measurement's value on the sheet, at the middle of its shape: pressing it opens the mark. */
export function SheetValueTag({ at, selected = false, className, ...props }: { at: PagePoint; selected?: boolean } & ComponentProps<'button'>): JSX.Element {
  return (
    <button
      type="button"
      data-slot="sheet-value-tag"
      aria-pressed={selected}
      className={cn(
        'border-paper-ink bg-sheet text-paper-ink pointer-events-auto absolute z-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-[3px] border px-1 py-px text-[11px] leading-4 font-medium whitespace-nowrap tabular-nums',
        'focus-visible:ring-ring/60 outline-none focus-visible:ring-2 aria-pressed:border-2',
        className
      )}
      style={sheetPlace(at)}
      {...props}
    />
  )
}

/** The surface that takes the tape's clicks, over the page's text layer. */
export function SheetClickSurface({ className, ...props }: ComponentProps<'div'>): JSX.Element {
  return (
    <div
      aria-hidden
      data-slot="sheet-click-surface"
      // A double tap here places points, it does not zoom.
      data-zoom-tap="off"
      className={cn('pointer-events-auto absolute inset-0 z-10 cursor-crosshair touch-manipulation', className)}
      {...props}
    />
  )
}

/** The middle of a shape, for its value tag: the mean of its points. */
export function middleOf(points: readonly PagePoint[]): PagePoint {
  const count = Math.max(points.length, 1)
  return [points.reduce((sum, [x]) => sum + x, 0) / count, points.reduce((sum, [, y]) => sum + y, 0) / count]
}
