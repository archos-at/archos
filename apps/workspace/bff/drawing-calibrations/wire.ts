import { z } from 'zod'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

export const CALIBRATION_STATUSES = ['active', 'superseded', 'withdrawn'] as const
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number]

export const CALIBRATION_LIFECYCLE = defineLifecycle<CalibrationStatus, 'supersede' | 'withdraw'>({
  id: 'drawing-calibration',
  initial: 'active',
  states: {
    active: { on: { supersede: 'superseded', withdraw: 'withdrawn' } },
    superseded: { type: 'final' },
    withdrawn: { type: 'final' },
  },
})

export const MAX_PAGE_CALIBRATIONS = 50

const share = z.number().finite().min(0).max(1)
const EDGE = 1.000001

export const calibrationPointSchema = z.object({ x: share, y: share }).strict()
export type CalibrationPoint = z.infer<typeof calibrationPointSchema>

export const calibrationRegionSchema = z
  .object({ x: share, y: share, w: share.gt(0), h: share.gt(0) })
  .strict()
  .refine((region) => region.x + region.w <= EDGE && region.y + region.h <= EDGE, 'The region must lie on the page.')
export type CalibrationRegion = z.infer<typeof calibrationRegionSchema>

export function inRegion(point: CalibrationPoint, region: CalibrationRegion): boolean {
  return (
    point.x >= region.x && point.x <= region.x + region.w && point.y >= region.y && point.y <= region.y + region.h
  )
}

export const REGION_TOLERANCE = 1e-6

export type RegionRelation = 'same' | 'inside' | 'contains' | 'apart' | 'overlaps'

const covers = (outer: CalibrationRegion, inner: CalibrationRegion): boolean =>
  inner.x >= outer.x - REGION_TOLERANCE &&
  inner.y >= outer.y - REGION_TOLERANCE &&
  inner.x + inner.w <= outer.x + outer.w + REGION_TOLERANCE &&
  inner.y + inner.h <= outer.y + outer.h + REGION_TOLERANCE

export function regionRelation(region: CalibrationRegion, other: CalibrationRegion): RegionRelation {
  const inside = covers(other, region)
  const contains = covers(region, other)
  if (inside && contains) return 'same'
  if (inside) return 'inside'
  if (contains) return 'contains'
  const across = Math.min(region.x + region.w, other.x + other.w) - Math.max(region.x, other.x)
  const down = Math.min(region.y + region.h, other.y + other.h) - Math.max(region.y, other.y)
  return across > REGION_TOLERANCE && down > REGION_TOLERANCE ? 'overlaps' : 'apart'
}

export const REGION_OVERLAPS = 'region-overlaps'

export const setCalibrationRequestSchema = z
  .object({
    page: z.number().int().min(1).max(100_000).describe('The page, starting at 1.'),
    region: calibrationRegionSchema.describe(
      'The part of the page the scale holds for, as shares of the page (origin top left). Required: the region the file stores a scale for when both points lie in one, otherwise a box around the drawing the points are in. Never the whole page by default.'
    ),
    from: calibrationPointSchema.describe('The first reference point, as shares of the page.'),
    to: calibrationPointSchema.describe('The second reference point.'),
    lengthM: z.number().finite().gt(0).max(100_000).describe('The true length between the two points, in metres.'),
  })
  .strict()
  .superRefine((input, context) => {
    if (!inRegion(input.from, input.region) || !inRegion(input.to, input.region)) {
      context.addIssue({ code: 'custom', message: 'Both reference points must lie inside the region.', path: ['region'] })
    }
    if (input.from.x === input.to.x && input.from.y === input.to.y) {
      context.addIssue({ code: 'custom', message: 'The two reference points must differ.', path: ['to'] })
    }
  })
export type SetCalibrationRequest = z.infer<typeof setCalibrationRequestSchema>

export const calibrationDocumentParamsSchema = z.object({ id: z.string().uuid() })
export const calibrationParamsSchema = calibrationDocumentParamsSchema.extend({ calibrationId: z.string().uuid() })

export interface PageCalibration {
  id: string
  region: CalibrationRegion
  from: CalibrationPoint
  to: CalibrationPoint
  lengthM: number
}

export const calibrationViewSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  versionId: z.string().uuid(),
  page: z.number().int(),
  region: calibrationRegionSchema,
  from: calibrationPointSchema,
  to: calibrationPointSchema,
  lengthM: z.number(),
  status: z.enum(CALIBRATION_STATUSES),
  createdBy: z.string(),
  createdAt: z.string(),
  withdrawnAt: z.string().nullable(),
  withdrawnBy: z.string().nullable(),
})
export type CalibrationView = z.infer<typeof calibrationViewSchema>

export const calibrationListResponseSchema = z.object({
  calibrations: z.array(calibrationViewSchema),
  nextCursor: z.string().nullable(),
  versionId: z.string().uuid().nullable(),
  canCalibrate: z.boolean(),
})
export type CalibrationListResponse = z.infer<typeof calibrationListResponseSchema>
