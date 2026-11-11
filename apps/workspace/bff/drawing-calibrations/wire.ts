/**
 * The wire of a drawing's calibrations (ADR-0183): what the routes take and
 * answer, shared with the agent catalog and the browser client. No
 * `server-only`: the review view validates with the same schemas.
 *
 * Places are shares of the page as shown (0 to 1, origin top left), as `look`'s
 * region and an annotation are. A calibration's region is REQUIRED: it is the
 * region the file stores a scale for when both points lie in one, otherwise a
 * box the person drew. It is never the page by default.
 */
import { z } from 'zod'
import { pageQueryShape } from '@/lib/api/offset-page'
import { defineLifecycle } from '@/shared/lifecycle/define-lifecycle'

export const CALIBRATION_STATUSES = ['active', 'superseded', 'withdrawn'] as const
export type CalibrationStatus = (typeof CALIBRATION_STATUSES)[number]

/**
 * A calibration's lifecycle (ADR-0179). It is born `active`. Setting the same
 * region again supersedes it; a person withdraws it. Both ends are final:
 * withdrawing the newer calibration does not revive the one it superseded.
 */
export const CALIBRATION_LIFECYCLE = defineLifecycle<CalibrationStatus, 'supersede' | 'withdraw'>({
  id: 'drawing-calibration',
  initial: 'active',
  states: {
    active: { on: { supersede: 'superseded', withdraw: 'withdrawn' } },
    superseded: { type: 'final' },
    withdrawn: { type: 'final' },
  },
})

/** The most calibrations the internal read hands the measuring tool for one page. */
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

export const listCalibrationsQuerySchema = z
  .object({
    ...pageQueryShape,
    page: z.coerce.number().int().min(1).max(100_000).optional().describe('Only this page’s calibrations.'),
    status: z.enum(CALIBRATION_STATUSES).optional().describe('Default `active`.'),
  })
  .strict()
export type ListCalibrationsQuery = z.infer<typeof listCalibrationsQuerySchema>

export const calibrationDocumentParamsSchema = z.object({ id: z.string().uuid() })
export const calibrationParamsSchema = calibrationDocumentParamsSchema.extend({ calibrationId: z.string().uuid() })

/** What the measuring tool is given of an active calibration (`GET /api/internal/document-file?calibrationsPage=`). */
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
  /** The version the calibrations belong to: the one the document shows now. Null: the document has no version, so none can be set. */
  versionId: z.string().uuid().nullable(),
  canCalibrate: z.boolean(),
})
export type CalibrationListResponse = z.infer<typeof calibrationListResponseSchema>
