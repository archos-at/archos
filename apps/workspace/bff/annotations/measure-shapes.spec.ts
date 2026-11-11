/**
 * @vitest-environment node
 */
/**
 * The three shapes a kept measurement has (ADR-0182, slice 8), at the door
 * every client passes through: how many points each takes, where a point may
 * lie, that a pin stays a pin, and that no caller sends the number.
 */
import { describe, expect, it } from 'vitest'
import {
  boxOfPoints,
  keptReadingSchema,
  MAX_MEASURE_POINTS,
  MEASURE_POINT_BOUNDS,
  MEASURE_SHAPES,
  pointsProblem,
  type PagePoint,
} from './measure-shapes'
import { annotationBox, annotationProposalSchema, createAnnotationRequestSchema } from './types'

const points = (count: number): PagePoint[] =>
  Array.from({ length: count }, (_, index) => [0.1 + index * 0.01, 0.2] as PagePoint)

const mark = (shape: string, placed: PagePoint[] | null | undefined, extra: Record<string, unknown> = {}) => ({
  page: 1,
  shape,
  x: placed?.[0]?.[0] ?? 0.1,
  y: placed?.[0]?.[1] ?? 0.2,
  ...(placed === undefined ? {} : { points: placed }),
  kind: 'hint',
  body: 'Distance',
  ...extra,
})

const accepts = (input: unknown) => createAnnotationRequestSchema.safeParse(input).success

describe('the shapes of a kept measurement', () => {
  it.each([
    ['line', 2, 2],
    ['path', 2, MAX_MEASURE_POINTS],
    ['polygon', 3, MAX_MEASURE_POINTS],
  ] as const)('a %s takes %i to %i points', (shape, fewest, most) => {
    expect(MEASURE_POINT_BOUNDS[shape]).toEqual([fewest, most])
    expect(accepts(mark(shape, points(fewest)))).toBe(true)
    expect(accepts(mark(shape, points(most)))).toBe(true)
    expect(accepts(mark(shape, points(fewest - 1)))).toBe(false)
    expect(accepts(mark(shape, points(most + 1)))).toBe(false)
  })

  it.each(MEASURE_SHAPES)('a %s needs its points, on the page, and has no size', (shape) => {
    const placed = points(3).slice(0, shape === 'line' ? 2 : 3)
    expect(accepts(mark(shape, undefined))).toBe(false)
    expect(accepts(mark(shape, null))).toBe(false)
    expect(accepts(mark(shape, [[0.1, 0.2], [1.2, 0.2], [0.3, 0.3]].slice(0, placed.length) as PagePoint[]))).toBe(false)
    expect(accepts(mark(shape, [[0.1, 0.2], [-0.1, 0.2], [0.3, 0.3]].slice(0, placed.length) as PagePoint[]))).toBe(false)
    expect(accepts(mark(shape, placed, { w: 0.2, h: 0.2 }))).toBe(false)
  })

  it('is placed at its first point, so a reader that knows only a pin finds it where it begins', () => {
    expect(accepts(mark('line', points(2), { x: 0.5, y: 0.5 }))).toBe(false)
    expect(pointsProblem('line', points(2))).toBeNull()
  })

  it('takes no number from the caller: the reading is the server’s to ask the engine for', () => {
    const reading = { value: 4, unit: 'm', low: 3.9, high: 4.1, provenance: 'vector_verified', scaleState: 'verified' }
    expect(accepts(mark('line', points(2), { measurement: reading }))).toBe(false)
  })

  it('leaves a point and a region as they were: neither carries points', () => {
    expect(accepts(mark('point', undefined))).toBe(true)
    expect(accepts(mark('region', undefined, { w: 0.2, h: 0.2 }))).toBe(true)
    expect(accepts(mark('point', points(2)))).toBe(false)
    expect(accepts(mark('region', points(2), { w: 0.2, h: 0.2 }))).toBe(false)
    expect(accepts(mark('point', undefined, { w: 0.2, h: 0.2 }))).toBe(false)
    expect(accepts(mark('region', undefined))).toBe(false)
  })

  it('is not a shape the agent’s canvas tools set: a proposal is a point or a region', () => {
    const proposal = { page: 1, shape: 'line', x: 0.1, y: 0.2, kind: 'hint', body: 'A line' }
    expect(annotationProposalSchema.safeParse(proposal).success).toBe(false)
    expect(annotationProposalSchema.safeParse({ ...proposal, shape: 'point' }).success).toBe(true)
  })
})

describe('the reading kept with a measurement', () => {
  const reading = { value: 4, unit: 'm', low: 3.98, high: 4.02, provenance: 'vector_estimated', scaleState: 'estimated' }

  it('is whole: the value, its unit, its interval, its provenance and the scale state', () => {
    expect(keptReadingSchema.safeParse(reading).success).toBe(true)
    for (const field of Object.keys(reading)) {
      const { [field as keyof typeof reading]: _left, ...rest } = reading
      expect(keptReadingSchema.safeParse(rest).success, `without ${field}`).toBe(false)
    }
  })

  it('has an interval that holds its value, a known unit, provenance and scale state, and nothing else', () => {
    expect(keptReadingSchema.safeParse({ ...reading, low: 4.01 }).success).toBe(false)
    expect(keptReadingSchema.safeParse({ ...reading, high: 3.99 }).success).toBe(false)
    expect(keptReadingSchema.safeParse({ ...reading, unit: 'cm' }).success).toBe(false)
    expect(keptReadingSchema.safeParse({ ...reading, provenance: 'guessed' }).success).toBe(false)
    expect(keptReadingSchema.safeParse({ ...reading, scaleState: 'fine' }).success).toBe(false)
    expect(keptReadingSchema.safeParse({ ...reading, note: 'x' }).success).toBe(false)
    expect(keptReadingSchema.safeParse({ ...reading, value: Number.NaN }).success).toBe(false)
  })
})

describe('a measurement’s place as a box', () => {
  it('is the box around its points, where a reader takes a box (the agent’s list of marks)', () => {
    const placed: PagePoint[] = [[0.4, 0.2], [0.1, 0.6], [0.3, 0.1]]
    expect(boxOfPoints(placed)).toEqual([0.1, 0.1, 0.4, 0.6])
    expect(annotationBox({ x: 0.4, y: 0.2, w: null, h: null, points: placed })).toEqual([0.1, 0.1, 0.4, 0.6])
    expect(annotationBox({ x: 0.4, y: 0.2, w: 0.1, h: 0.2 })).toEqual([0.4, 0.2, 0.5, 0.4])
  })
})
