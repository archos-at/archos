import { ApiError } from '@/lib/api/api-error'
import { REGION_OVERLAPS, type CalibrationRegion } from './wire'

export const REGION_OVERLAPS_PROBLEM_TYPE = 'urn:problem-type:region-overlaps'

const shares = (region: CalibrationRegion): string =>
  `x ${region.x.toFixed(3)}, y ${region.y.toFixed(3)}, w ${region.w.toFixed(3)}, h ${region.h.toFixed(3)}`

export function regionOverlapsProblem(overlapping: { id: string; page: number; region: CalibrationRegion }) {
  const detail =
    `The region partly overlaps the active calibration ${overlapping.id} on page ${overlapping.page} (${shares(overlapping.region)}). ` +
    'Calibrations on one page lie apart or one wholly inside the other, never partly over each other, so no place has two scales. ' +
    `Draw the region wholly inside or wholly around that one, or clear of it, or withdraw ${overlapping.id} first.`
  return {
    type: REGION_OVERLAPS_PROBLEM_TYPE,
    title: 'Conflict',
    status: 409,
    code: REGION_OVERLAPS,
    detail,
    error: detail,
    overlapping: overlapping.id,
  }
}

export class RegionOverlapsError extends ApiError {
  readonly problem: ReturnType<typeof regionOverlapsProblem>

  constructor(overlapping: { id: string; page: number; region: CalibrationRegion }) {
    const problem = regionOverlapsProblem(overlapping)
    super(409, problem.code, problem.detail)
    this.problem = problem
  }
}
