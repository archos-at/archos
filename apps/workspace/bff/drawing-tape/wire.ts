import { z } from 'zod'
import {
  MAX_MEASURE_POINTS,
  MEASURE_PROVENANCES,
  MEASURE_UNITS,
  pagePointSchema,
  SCALE_STATES,
} from '@/lib/annotations/measure-shapes'

export const TAPE_OPERATIONS = ['distance', 'path', 'area', 'snap'] as const
export type TapeOperation = (typeof TAPE_OPERATIONS)[number]

const FEWEST_POINTS: Record<TapeOperation, number> = { distance: 2, path: 2, area: 3, snap: 1 }

export const measureRequestSchema = z
  .object({
    page: z.number().int().min(1).max(100_000).describe('The page, starting at 1.'),
    operation: z
      .enum(TAPE_OPERATIONS)
      .describe('`distance` (two points), `path` (two or more), `area` (three or more corners in order), or `snap`.'),
    points: z
      .array(pagePointSchema)
      .min(1)
      .max(MAX_MEASURE_POINTS)
      .describe('[[x, y], ...]: shares of the page as shown, 0 to 1, origin top left.'),
  })
  .strict()
  .superRefine((value, context) => {
    const fewest = FEWEST_POINTS[value.operation]
    const exact = value.operation === 'distance'
    if (value.points.length < fewest || (exact && value.points.length !== fewest)) {
      context.addIssue({
        code: 'custom',
        path: ['points'],
        message: `${value.operation} takes ${exact ? 'exactly' : 'at least'} ${fewest} points`,
      })
    }
  })
export type MeasureRequest = z.infer<typeof measureRequestSchema>

const place = z.tuple([z.number(), z.number()])

export const tapeMeasurementSchema = z.object({
  quantity: z.string(),
  value: z.number(),
  unit: z.enum(MEASURE_UNITS),
  low: z.number(),
  high: z.number(),
  provenance: z.enum(MEASURE_PROVENANCES),
  scaleState: z.enum(SCALE_STATES),
  scaleRatio: z.number().nullable(),
  printed: z.string().max(200).nullable(),
  printedCheck: z.object({ text: z.string().max(200), agrees: z.boolean().nullable() }).nullable().optional(),
  perimeter: z.number().nullable().optional(),
  verdict: z.enum(['met', 'not_met', 'undecidable']).nullable(),
  reasons: z.array(z.string()),
  points: z.array(place),
})
export type TapeMeasurement = z.infer<typeof tapeMeasurementSchema>

export const TAPE_CODES = [
  'uncalibrated',
  'several_in_reach',
  'none_in_reach',
  'too_dense',
  'too_flat',
  'two_regions',
  'scan',
  'not_an_area',
  'other',
] as const
export type TapeCode = (typeof TAPE_CODES)[number]
const tapeCode = z.enum(TAPE_CODES).catch('other')

export const tapeNoNumberSchema = z.object({
  code: tapeCode,
  reason: z.string(),
  remedy: z.string(),
  scaleState: z.enum(SCALE_STATES).nullable(),
  candidates: z.array(place),
})
export type TapeNoNumber = z.infer<typeof tapeNoNumberSchema>

export const tapeSnapSchema = z.object({
  snapped: place.nullable(),
  movedPt: z.number().nullable(),
  code: tapeCode.nullable(),
  detail: z.string().nullable(),
  candidates: z.array(place),
})
export type TapeSnap = z.infer<typeof tapeSnapSchema>

export const measureResponseSchema = z.union([
  z.object({ measurement: tapeMeasurementSchema }).strict(),
  z.object({ noNumber: tapeNoNumberSchema }).strict(),
  z.object({ snap: z.array(tapeSnapSchema) }).strict(),
])
export type MeasureResponse = z.infer<typeof measureResponseSchema>

export const measurePath = (documentId: string) => `/api/documents/${encodeURIComponent(documentId)}/measure`

export const isTapeDocument = (document: { filename: string }) => document.filename.toLowerCase().endsWith('.pdf')
