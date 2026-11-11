import type { FC } from 'react'

/** A point as shares of the element the mark sits in, origin top left. */
export type SpanPoint = readonly [number, number]

export interface SpanMarkProps {
  from: SpanPoint
  to: SpanPoint
  /** CSS colour of the line; the mark's own tint when unset. */
  color?: string
}

const percent = (share: number): string => `${share * 100}%`

/**
 * A straight span between two points on a picture of a page, with a dot at
 * each end: the reference length of a calibration. Like `RegionMarks` it is
 * positioned in PERCENT of the element it sits in, so the parent only has to
 * be `relative` and exactly the size of the drawn part.
 *
 * Drawn twice, a white line under the coloured one, because a drawing is dark
 * lines on white and a span that follows a wall would otherwise vanish into
 * it. The dots have a fixed size in pixels: they mark a point, not an area.
 */
export const SpanMark: FC<SpanMarkProps> = ({ from, to, color = 'var(--passage-tint, var(--law-blue))' }) => {
  const line = { x1: percent(from[0]), y1: percent(from[1]), x2: percent(to[0]), y2: percent(to[1]) }
  return (
    <svg aria-hidden data-testid="span-mark" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible">
      <line {...line} stroke="white" strokeWidth={5} strokeLinecap="round" />
      <line {...line} data-testid="span-mark-line" stroke={color} strokeWidth={2} strokeLinecap="round" />
      {[from, to].map(([x, y], index) => (
        <circle
          key={index}
          data-testid="span-mark-end"
          cx={percent(x)}
          cy={percent(y)}
          r={4.5}
          fill={color}
          stroke="white"
          strokeWidth={2}
        />
      ))}
    </svg>
  )
}
