/**
 * The person's tape on a PDF drawing, as data: the wire schemas the route, the
 * agent catalog and the browser's client share (ADR-0055, ADR-0182 slice 8).
 *
 * `POST /api/documents/{id}/measure` takes a page, an operation and points as
 * shares of the page as shown (origin top left) and answers what the ENGINE
 * says for the document's current version: where each point snaps, or a
 * measurement with its interval, provenance and scale state, or no number with
 * the reason and the remedy. The browser computes none of it.
 *
 * No `server-only` and no drizzle: the browser imports this.
 */

import { z } from 'zod'
import {
  MAX_MEASURE_POINTS,
  MEASURE_PROVENANCES,
  MEASURE_UNITS,
  pagePointSchema,
  SCALE_STATES,
} from '@/lib/annotations/measure-shapes'

/** `snap` ties points to linework without measuring; the other three are the engine's measuring operations. */
export const TAPE_OPERATIONS = ['distance', 'path', 'area', 'snap'] as const
export type TapeOperation = (typeof TAPE_OPERATIONS)[number]

/** The fewest points each operation takes; a distance takes exactly two. */
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

/** A place the engine answers with: shares of the page, as it rounds them. */
const place = z.tuple([z.number(), z.number()])

/** One number with what it rests on, exactly as the engine answered it. */
export const tapeMeasurementSchema = z.object({
  quantity: z.string(),
  value: z.number(),
  unit: z.enum(MEASURE_UNITS),
  low: z.number(),
  high: z.number(),
  provenance: z.enum(MEASURE_PROVENANCES),
  scaleState: z.enum(SCALE_STATES),
  /** The N of 1:N a person reads, where the region has a scale. */
  scaleRatio: z.number().nullable(),
  /** The dimension figure the value was read off, as printed; only where nothing was measured (`printed_figure`). */
  printed: z.string().max(200).nullable(),
  /** Always null for a person's tape: no threshold is passed, so nothing is decided. */
  verdict: z.enum(['met', 'not_met', 'undecidable']).nullable(),
  reasons: z.array(z.string()),
  /** The points as the engine tied them to linework. */
  points: z.array(place),
})
export type TapeMeasurement = z.infer<typeof tapeMeasurementSchema>

/**
 * Why there is no number, as the engine decides it (`agent.drawings.sheet_answers.Cause`). The interface words each
 * one itself, in the reader's language; a code this build does not know reads as `other`.
 */
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

/**
 * No number, and why: the `code` an interface words, the candidates a point could be placed on, and the engine's
 * own English reason and remedy, which are for support and never a person's text.
 */
export const tapeNoNumberSchema = z.object({
  code: tapeCode,
  reason: z.string(),
  remedy: z.string(),
  scaleState: z.enum(SCALE_STATES).nullable(),
  candidates: z.array(place),
})
export type TapeNoNumber = z.infer<typeof tapeNoNumberSchema>

/** Where one point lands: the snapped place, or the code of why none (several in reach come with the candidates). */
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

/** Whether a document is one the tape reads: a PDF, by the name the engine finds its bytes under. */
export const isTapeDocument = (document: { filename: string }) => document.filename.toLowerCase().endsWith('.pdf')
