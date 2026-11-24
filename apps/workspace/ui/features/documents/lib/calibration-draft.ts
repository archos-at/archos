import { calibrationRatio, type PageSizePt } from '@/lib/drawing-calibrations/display-ratio'
import {
  inRegion,
  regionRelation,
  setCalibrationRequestSchema,
  type CalibrationPoint,
  type CalibrationRegion,
  type CalibrationView,
  type SetCalibrationRequest,
} from '@/lib/drawing-calibrations/wire'

export interface CalibrationDraft {
  readonly page: number
  readonly from: CalibrationPoint | null
  readonly to: CalibrationPoint | null
  readonly region: CalibrationRegion | null
}

export type CalibrationBlock = 'firstPoint' | 'secondPoint' | 'region' | 'regionMisses' | 'overlaps' | 'length'

export interface CalibrationProposal {
  readonly ratio: string | null
  readonly blocked: CalibrationBlock | null
  readonly overlaps: CalibrationView | null
  readonly replaces: CalibrationView | null
  readonly request: SetCalibrationRequest | null
}

const round = (share: number) => Math.round(Math.min(1, Math.max(0, share)) * 1_000_000) / 1_000_000
const place = (point: CalibrationPoint): CalibrationPoint => ({ x: round(point.x), y: round(point.y) })

export const emptyDraft = (page: number): CalibrationDraft => ({ page, from: null, to: null, region: null })

export function pickPoint(draft: CalibrationDraft, page: number, point: CalibrationPoint): CalibrationDraft {
  const at = place(point)
  if (draft.page !== page || !draft.from) return { ...emptyDraft(page), from: at }
  if (draft.to) return draft
  if (at.x === draft.from.x && at.y === draft.from.y) return draft
  return { ...draft, to: at }
}

export function withRegion(draft: CalibrationDraft, page: number, region: CalibrationRegion): CalibrationDraft {
  if (draft.page !== page) return draft
  const x = round(region.x)
  const y = round(region.y)
  return { ...draft, region: { x, y, w: round(Math.min(region.w, 1 - x)), h: round(Math.min(region.h, 1 - y)) } }
}

export function proposalOf(
  draft: CalibrationDraft | null,
  lengthM: number | null,
  pageSize: PageSizePt | null,
  active: readonly CalibrationView[]
): CalibrationProposal {
  const none = { ratio: null, overlaps: null, replaces: null, request: null }
  if (!draft?.from) return { ...none, blocked: 'firstPoint' }
  const { from, to, region, page } = draft
  if (!to) return { ...none, blocked: 'secondPoint' }
  const ratio = lengthM !== null && pageSize ? calibrationRatio({ from, to, lengthM }, pageSize) : null
  if (!region) return { ...none, ratio, blocked: 'region' }
  if (!inRegion(from, region) || !inRegion(to, region)) return { ...none, ratio, blocked: 'regionMisses' }
  const onPage = active.filter((entry) => entry.page === page)
  const overlaps = onPage.find((entry) => regionRelation(region, entry.region) === 'overlaps') ?? null
  const replaces = onPage.find((entry) => regionRelation(region, entry.region) === 'same') ?? null
  if (overlaps) return { ...none, ratio, overlaps, blocked: 'overlaps' }
  const request = lengthM === null ? null : setCalibrationRequestSchema.safeParse({ page, region, from, to, lengthM })
  if (!request?.success) return { ...none, ratio, replaces, blocked: 'length' }
  return { ratio, blocked: null, overlaps: null, replaces, request: request.data }
}

export const requestOf = (entry: CalibrationView): SetCalibrationRequest => ({
  page: entry.page,
  region: entry.region,
  from: entry.from,
  to: entry.to,
  lengthM: entry.lengthM,
})

export type RegionPlace =
  | 'page'
  | 'topLeft'
  | 'top'
  | 'topRight'
  | 'left'
  | 'centre'
  | 'right'
  | 'bottomLeft'
  | 'bottom'
  | 'bottomRight'

const PLACES: readonly (readonly RegionPlace[])[] = [
  ['topLeft', 'top', 'topRight'],
  ['left', 'centre', 'right'],
  ['bottomLeft', 'bottom', 'bottomRight'],
]

export function regionPlace(region: CalibrationRegion): RegionPlace {
  if (region.w >= 0.9 && region.h >= 0.9) return 'page'
  const third = (start: number, size: number) => Math.min(2, Math.floor((start + size / 2) * 3))
  return PLACES[third(region.y, region.h)]?.[third(region.x, region.w)] ?? 'centre'
}

export const byAreaDescending = (a: CalibrationView, b: CalibrationView) =>
  b.region.w * b.region.h - a.region.w * a.region.h
