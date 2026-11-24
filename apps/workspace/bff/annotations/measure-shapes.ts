import { z } from 'zod'

export const PIN_SHAPES = ['point', 'region'] as const
export type PinShape = (typeof PIN_SHAPES)[number]

export const MEASURE_SHAPES = ['line', 'path', 'polygon'] as const
export type MeasureShape = (typeof MEASURE_SHAPES)[number]

export const isMeasureShape = (shape: string): shape is MeasureShape =>
  (MEASURE_SHAPES as readonly string[]).includes(shape)

export const MAX_MEASURE_POINTS = 60

export const MEASURE_POINT_BOUNDS: Record<MeasureShape, readonly [number, number]> = {
  line: [2, 2],
  path: [2, MAX_MEASURE_POINTS],
  polygon: [3, MAX_MEASURE_POINTS],
}

const share = z.number().finite().min(0).max(1)

export const pagePointSchema = z.tuple([share, share])
export type PagePoint = z.infer<typeof pagePointSchema>

export const measurePointsSchema = z.array(pagePointSchema).min(2).max(MAX_MEASURE_POINTS)

export function pointsProblem(shape: string, points: readonly PagePoint[] | null | undefined): string | null {
  if (!isMeasureShape(shape)) return points == null ? null : `a ${shape} has no points`
  const [fewest, most] = MEASURE_POINT_BOUNDS[shape]
  if (!points) return `a ${shape} needs its points`
  if (points.length < fewest || points.length > most) {
    return fewest === most ? `a ${shape} has exactly ${fewest} points` : `a ${shape} has ${fewest} to ${most} points`
  }
  return null
}

export const MEASURE_OPERATION_OF = { line: 'distance', path: 'path', polygon: 'area' } as const satisfies Record<
  MeasureShape,
  string
>

export const MEASURE_PROVENANCES = ['printed_figure', 'vector_verified', 'vector_estimated'] as const
export type MeasureProvenance = (typeof MEASURE_PROVENANCES)[number]

export const SCALE_STATES = ['verified', 'estimated', 'uncalibrated'] as const
export type ScaleState = (typeof SCALE_STATES)[number]

export const MEASURE_UNITS = ['m', 'm2'] as const
export type MeasureUnit = (typeof MEASURE_UNITS)[number]

export const keptReadingSchema = z
  .object({
    value: z.number().finite(),
    unit: z.enum(MEASURE_UNITS),
    low: z.number().finite(),
    high: z.number().finite(),
    provenance: z.enum(MEASURE_PROVENANCES),
    scaleState: z.enum(SCALE_STATES),
    scaleRatio: z.number().finite().positive().nullable().optional(),
    printed: z.string().max(200).nullable().optional(),
  })
  .strict()
  .refine((reading) => reading.low <= reading.value && reading.value <= reading.high, {
    message: 'the interval holds the value',
  })
export type KeptReading = z.infer<typeof keptReadingSchema>

export function boxOfPoints(points: readonly PagePoint[]): [number, number, number, number] {
  const xs = points.map(([x]) => x)
  const ys = points.map(([, y]) => y)
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}
