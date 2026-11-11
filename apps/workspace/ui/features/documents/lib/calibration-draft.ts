/**
 * A calibration being set in the review view, before it is saved: the two
 * reference points, their true length and the region the scale will hold for.
 * Pure: the hook holds one of these, the page layer and the panel draw it.
 *
 * The region is never the page by default (the build spec's decision 7). It is
 * the region the file stores a scale for when both points lie in one;
 * otherwise the person draws a box that holds both points, and nothing can be
 * saved before that.
 */
import {
  calibrationRatio,
  regionHolding,
  type PageSizePt,
} from '@/lib/drawing-calibrations/display-ratio'
import {
  inRegion,
  setCalibrationRequestSchema,
  type CalibrationPoint,
  type CalibrationRegion,
  type SetCalibrationRequest,
} from '@/lib/drawing-calibrations/wire'

export interface CalibrationDraft {
  readonly page: number
  /** The page as shown, in points: what turns shares of it into a scale. */
  readonly pageSize: PageSizePt
  readonly from: CalibrationPoint
  readonly to: CalibrationPoint | null
  /** The box the person drew; unused while a stored region holds both points. */
  readonly drawn: CalibrationRegion | null
  readonly lengthM: number | null
}

/** The regions a file stores a scale for, by page. Served by no route yet: see `useReviewCalibration`. */
export type StoredRegions = Readonly<Record<number, readonly CalibrationRegion[]>>

/**
 * Why a draft cannot be saved yet, in the order a person meets them: the second
 * point, the region to draw, a drawn region that misses a point, the length.
 */
export type CalibrationBlock = 'secondPoint' | 'region' | 'regionMisses' | 'length'

export interface CalibrationProposal {
  /** The region the calibration will hold for; null until there is one that holds both points. */
  readonly region: CalibrationRegion | null
  /** Where the region comes from: the file's own, or the person's box. */
  readonly regionSource: 'stored' | 'drawn' | null
  /** The ratio as it will read, „1:100“, once both points and the length are there. */
  readonly ratio: string | null
  readonly blocked: CalibrationBlock | null
  /** What saving sends: null while blocked. */
  readonly request: SetCalibrationRequest | null
}

const round = (share: number) => Math.round(Math.min(1, Math.max(0, share)) * 1_000_000) / 1_000_000
const place = (point: CalibrationPoint): CalibrationPoint => ({ x: round(point.x), y: round(point.y) })

/**
 * A click on a page with the calibrate tool in hand: the first point, then the
 * second. A click on another page starts over there, since a reference length
 * lies on one page. With both points set a click changes nothing: the region is
 * drawn by dragging, and the points are set anew on request (`withoutPoints`).
 */
export function pickPoint(
  draft: CalibrationDraft | null,
  page: number,
  point: CalibrationPoint,
  pageSize: PageSizePt
): CalibrationDraft {
  const at = place(point)
  if (!draft || draft.page !== page) return { page, pageSize, from: at, to: null, drawn: null, lengthM: draft?.lengthM ?? null }
  if (draft.to) return draft
  if (at.x === draft.from.x && at.y === draft.from.y) return draft
  return { ...draft, pageSize, to: at }
}

/** The region the person drew on the draft's page; a box on another page is not this draft's. */
export function withDrawnRegion(draft: CalibrationDraft, page: number, region: CalibrationRegion): CalibrationDraft {
  if (draft.page !== page) return draft
  const x = round(region.x)
  const y = round(region.y)
  return { ...draft, drawn: { x, y, w: round(Math.min(region.w, 1 - x)), h: round(Math.min(region.h, 1 - y)) } }
}

export const withLength = (draft: CalibrationDraft, lengthM: number | null): CalibrationDraft => ({ ...draft, lengthM })

/** What a draft amounts to: its region, the ratio it gives, and what is still missing. */
export function proposalOf(draft: CalibrationDraft | null, stored: StoredRegions = {}): CalibrationProposal {
  const nothing = { region: null, regionSource: null, ratio: null, request: null }
  if (!draft?.to) return { ...nothing, blocked: 'secondPoint' }
  const { from, to, lengthM, page } = draft
  const ratio = lengthM === null ? null : calibrationRatio({ from, to, lengthM }, draft.pageSize)
  const storedRegion = regionHolding(stored[page] ?? [], from, to)
  if (!storedRegion && !draft.drawn) return { ...nothing, ratio, blocked: 'region' }
  const region = storedRegion ?? draft.drawn
  const regionSource = storedRegion ? 'stored' : 'drawn'
  if (!region || !inRegion(from, region) || !inRegion(to, region)) {
    return { region: null, regionSource: null, ratio, blocked: 'regionMisses', request: null }
  }
  if (lengthM === null || ratio === null) return { region, regionSource, ratio: null, blocked: 'length', request: null }
  const request = setCalibrationRequestSchema.safeParse({ page, region, from, to, lengthM })
  if (!request.success) return { region, regionSource, ratio, blocked: 'length', request: null }
  return { region, regionSource, ratio, blocked: null, request: request.data }
}
