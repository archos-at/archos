/**
 * A measurement kept on a sheet: the three shapes that carry a points array,
 * and the reading the engine answered when the measurement was kept (ADR-0182,
 * slice 8; migration 0237).
 *
 * A `line` is exactly two points (a distance), a `path` two to sixty (a length
 * along them), a `polygon` three to sixty (the area they enclose). Points are
 * shares of the page as shown, origin top left: the frame every place on a
 * page crosses a boundary in. The mark's `x`/`y` is its first point, so a
 * reader that knows only a pin still finds the measurement where it begins.
 *
 * The reading is never the browser's: `./kept-reading.ts` asks the engine for
 * these points at the moment the mark is kept and stores what it answered,
 * whole, in one JSON column. It is one value, written once and read whole, and
 * true of one version of the document, which is why a measurement is not
 * carried onto a newer one.
 */

import { z } from 'zod'

/** The shapes a pin has: a point or a region. What an agent's canvas tools set. */
export const PIN_SHAPES = ['point', 'region'] as const
export type PinShape = (typeof PIN_SHAPES)[number]

/** The shapes of a kept measurement. */
export const MEASURE_SHAPES = ['line', 'path', 'polygon'] as const
export type MeasureShape = (typeof MEASURE_SHAPES)[number]

export const isMeasureShape = (shape: string): shape is MeasureShape =>
  (MEASURE_SHAPES as readonly string[]).includes(shape)

/** As many points as the engine takes for a path or an area. The CHECK `…_points_for_measure_shapes` holds the same. */
export const MAX_MEASURE_POINTS = 60

/** How many points each shape takes: `[fewest, most]`. */
export const MEASURE_POINT_BOUNDS: Record<MeasureShape, readonly [number, number]> = {
  line: [2, 2],
  path: [2, MAX_MEASURE_POINTS],
  polygon: [3, MAX_MEASURE_POINTS],
}

const share = z.number().finite().min(0).max(1)

/** One place on the page: `[x, y]`, shares of the page as shown. */
export const pagePointSchema = z.tuple([share, share])
export type PagePoint = z.infer<typeof pagePointSchema>

export const measurePointsSchema = z.array(pagePointSchema).min(2).max(MAX_MEASURE_POINTS)

/** Why these points are not this shape's, or null. A pin has none; a measure shape has its bounded count. */
export function pointsProblem(shape: string, points: readonly PagePoint[] | null | undefined): string | null {
  if (!isMeasureShape(shape)) return points == null ? null : `a ${shape} has no points`
  const [fewest, most] = MEASURE_POINT_BOUNDS[shape]
  if (!points) return `a ${shape} needs its points`
  if (points.length < fewest || points.length > most) {
    return fewest === most ? `a ${shape} has exactly ${fewest} points` : `a ${shape} has ${fewest} to ${most} points`
  }
  return null
}

/** The engine's operation for each shape (`drawing_measure`'s own names). */
export const MEASURE_OPERATION_OF = { line: 'distance', path: 'path', polygon: 'area' } as const satisfies Record<
  MeasureShape,
  string
>

/** Where a value came from, as the engine names it (`agent.drawings.sheet_answers.Provenance`). */
export const MEASURE_PROVENANCES = ['printed_figure', 'vector_verified', 'vector_estimated'] as const
export type MeasureProvenance = (typeof MEASURE_PROVENANCES)[number]

/** What the scale under a measurement rests on (`agent.drawings.sheet_scale`). */
export const SCALE_STATES = ['verified', 'estimated', 'uncalibrated'] as const
export type ScaleState = (typeof SCALE_STATES)[number]

export const MEASURE_UNITS = ['m', 'm2'] as const

/**
 * What the engine answered when a measurement was kept: the value with its
 * interval, where it came from and the scale it rests on. The CHECK
 * `…_measurement_reading` holds the same shape in the database.
 */
export const keptReadingSchema = z
  .object({
    value: z.number().finite(),
    unit: z.enum(MEASURE_UNITS),
    low: z.number().finite(),
    high: z.number().finite(),
    provenance: z.enum(MEASURE_PROVENANCES),
    scaleState: z.enum(SCALE_STATES),
  })
  .strict()
  .refine((reading) => reading.low <= reading.value && reading.value <= reading.high, {
    message: 'the interval holds the value',
  })
export type KeptReading = z.infer<typeof keptReadingSchema>

/** The smallest box around the points, `[x0, y0, x1, y1]`: a measurement's place for a reader that takes a box. */
export function boxOfPoints(points: readonly PagePoint[]): [number, number, number, number] {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
