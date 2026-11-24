import {
  calibrationDocumentParamsSchema,
  setCalibrationRequestSchema,
  type CalibrationPoint,
  type SetCalibrationRequest,
} from '@/lib/drawing-calibrations/wire'
import { isCalibrationProposal } from '@/lib/drawing-calibrations/operation'

export interface ProposedCalibration {
  documentId: string
  calibration: SetCalibrationRequest
}

export function proposedCalibrationOf(
  operation: string,
  input: Record<string, unknown>
): ProposedCalibration | null {
  if (!isCalibrationProposal(operation)) return null
  const params = calibrationDocumentParamsSchema.safeParse(input.params)
  const body = setCalibrationRequestSchema.safeParse(input.body)
  if (!params.success || !body.success) return null
  return { documentId: params.data.id, calibration: body.data }
}

export const CLIP_ASPECT = 3 / 2
const SPAN_MARGIN = 0.18
const MIN_CROP_PT = 72

export interface CropPt {
  x: number
  y: number
  width: number
  height: number
}

export function spanCrop(
  page: { width: number; height: number },
  from: CalibrationPoint,
  to: CalibrationPoint,
  minWidthPt = MIN_CROP_PT
): CropPt {
  const across = Math.abs(to.x - from.x) * page.width * (1 + 2 * SPAN_MARGIN)
  const down = Math.abs(to.y - from.y) * page.height * (1 + 2 * SPAN_MARGIN)
  const wide = Math.max(across, down * CLIP_ASPECT, MIN_CROP_PT, minWidthPt)
  const width = Math.min(wide, page.width)
  const height = Math.min(wide / CLIP_ASPECT, page.height)
  const place = (centre: number, size: number, total: number): number =>
    Math.min(Math.max(0, centre - size / 2), total - size)
  return {
    x: place(((from.x + to.x) / 2) * page.width, width, page.width),
    y: place(((from.y + to.y) / 2) * page.height, height, page.height),
    width,
    height,
  }
}
