import {
  calibrationDocumentParamsSchema,
  setCalibrationRequestSchema,
  type CalibrationPoint,
  type SetCalibrationRequest,
} from '@/lib/drawing-calibrations/wire'
import { isCalibrationProposal } from './calibration-operation'

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

const SPAN_PAD = 0.01

export function spanBox(
  from: CalibrationPoint,
  to: CalibrationPoint
): [number, number, number, number] {
  const pad = (low: number, high: number): [number, number] =>
    high - low >= 2 * SPAN_PAD
      ? [low, high]
      : [Math.max(0, (low + high) / 2 - SPAN_PAD), Math.min(1, (low + high) / 2 + SPAN_PAD)]
  const [x0, x1] = pad(Math.min(from.x, to.x), Math.max(from.x, to.x))
  const [y0, y1] = pad(Math.min(from.y, to.y), Math.max(from.y, to.y))
  return [x0, y0, x1, y1]
}
