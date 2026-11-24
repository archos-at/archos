import {
  formatRatio,
  metresPerPoint,
  ratioDenominator,
  type PageSizePt,
} from '@/lib/drawing-calibrations/display-ratio'
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

export type CalibrationBlock =
  'firstPoint' | 'secondPoint' | 'length' | 'region' | 'regionMisses' | 'overlaps'

export type CalibrationStep = 'firstPoint' | 'secondPoint' | 'length' | 'region' | 'review'

export type DraftEnd = 'from' | 'to'

export interface DraftState {
  readonly draft: CalibrationDraft
  readonly lengthM: number | null
}

export interface StandardScale {
  readonly ratio: string
  readonly lengthM: number
}

export interface CalibrationProposal {
  readonly ratio: string | null
  readonly standard: StandardScale | null
  readonly blocked: CalibrationBlock | null
  readonly overlaps: CalibrationView | null
  readonly replaces: CalibrationView | null
  readonly request: SetCalibrationRequest | null
}

const round = (share: number) => Math.round(Math.min(1, Math.max(0, share)) * 1_000_000) / 1_000_000
const place = (point: CalibrationPoint): CalibrationPoint => ({
  x: round(point.x),
  y: round(point.y),
})

export const emptyDraft = (page: number): CalibrationDraft => ({
  page,
  from: null,
  to: null,
  region: null,
})

export function pickPoint(
  draft: CalibrationDraft,
  page: number,
  point: CalibrationPoint
): CalibrationDraft {
  const at = place(point)
  if (draft.page !== page || !draft.from) return { ...emptyDraft(page), from: at }
  if (draft.to) return draft
  if (at.x === draft.from.x && at.y === draft.from.y) return draft
  return { ...draft, to: at }
}

export function withPoint(
  draft: CalibrationDraft,
  end: DraftEnd,
  point: CalibrationPoint
): CalibrationDraft {
  return draft[end] ? { ...draft, [end]: place(point) } : draft
}

export const WHOLE_PAGE: CalibrationRegion = { x: 0, y: 0, w: 1, h: 1 }

export function stepOf({ draft, lengthM }: DraftState): CalibrationStep {
  if (!draft.from) return 'firstPoint'
  if (!draft.to) return 'secondPoint'
  if (draft.region) return 'review'
  return lengthM === null ? 'length' : 'region'
}

export function stepBack(state: DraftState): DraftState | null {
  const { draft } = state
  switch (stepOf(state)) {
    case 'review':
      return { ...state, draft: { ...draft, region: null } }
    case 'region':
      return { ...state, lengthM: null }
    case 'length':
      return { ...state, draft: { ...draft, to: null } }
    case 'secondPoint':
      return { ...state, draft: { ...draft, from: null } }
    case 'firstPoint':
      return null
  }
}

export function withRegion(
  draft: CalibrationDraft,
  page: number,
  region: CalibrationRegion
): CalibrationDraft {
  if (draft.page !== page) return draft
  const x = round(region.x)
  const y = round(region.y)
  return {
    ...draft,
    region: { x, y, w: round(Math.min(region.w, 1 - x)), h: round(Math.min(region.h, 1 - y)) },
  }
}

export const STANDARD_SCALES = [
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
] as const
const STANDARD_REACH = 0.03

type Span = { from: CalibrationPoint; to: CalibrationPoint; lengthM: number }

const denominatorOf = (span: Span, page: PageSizePt): number | null => {
  const scale = metresPerPoint(span.from, span.to, span.lengthM, page)
  return scale === null ? null : ratioDenominator(scale)
}

export function standardScaleOf(span: Span, page: PageSizePt): StandardScale | null {
  const drawn = denominatorOf(span, page)
  if (drawn === null) return null
  const off = (scale: number) => Math.abs(scale / drawn - 1)
  const nearest = STANDARD_SCALES.reduce((best, scale) => (off(scale) < off(best) ? scale : best))
  const ratio = formatRatio(nearest)
  if (off(nearest) > STANDARD_REACH || formatRatio(drawn) === ratio) return null
  const exact = (span.lengthM * nearest) / drawn
  const millimetres = Math.round(exact * 1000) / 1000
  const held = denominatorOf({ ...span, lengthM: millimetres }, page)
  return { ratio, lengthM: held !== null && formatRatio(held) === ratio ? millimetres : exact }
}

export function proposalOf(
  draft: CalibrationDraft | null,
  lengthM: number | null,
  pageSize: PageSizePt | null,
  active: readonly CalibrationView[]
): CalibrationProposal {
  const none = { ratio: null, standard: null, overlaps: null, replaces: null, request: null }
  if (!draft?.from) return { ...none, blocked: 'firstPoint' }
  const { from, to, region, page } = draft
  if (!to) return { ...none, blocked: 'secondPoint' }
  if (lengthM === null) return { ...none, blocked: 'length' }
  const drawn = pageSize ? denominatorOf({ from, to, lengthM }, pageSize) : null
  const ratio = drawn === null ? null : formatRatio(drawn)
  const standard = pageSize ? standardScaleOf({ from, to, lengthM }, pageSize) : null
  const told = { ...none, ratio, standard }
  if (!region) return { ...told, blocked: 'region' }
  if (!inRegion(from, region) || !inRegion(to, region)) return { ...told, blocked: 'regionMisses' }
  const onPage = active.filter((entry) => entry.page === page)
  const overlaps =
    onPage.find((entry) => regionRelation(region, entry.region) === 'overlaps') ?? null
  const replaces = onPage.find((entry) => regionRelation(region, entry.region) === 'same') ?? null
  if (overlaps) return { ...told, overlaps, blocked: 'overlaps' }
  const request = setCalibrationRequestSchema.safeParse({ page, region, from, to, lengthM })
  if (!request.success) return { ...told, replaces, blocked: 'length' }
  return { ...told, blocked: null, replaces, request: request.data }
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

export type RegionName =
  | { kind: 'place'; place: RegionPlace }
  | { kind: 'detail'; place: RegionPlace; within: CalibrationView }

export type Framed = Pick<CalibrationView, 'id' | 'page' | 'region'>

export function regionName(entry: Framed, others: readonly CalibrationView[]): RegionName {
  const place = regionPlace(entry.region)
  const within = others
    .filter(
      (other) =>
        other.id !== entry.id &&
        other.page === entry.page &&
        regionRelation(entry.region, other.region) === 'inside'
    )
    .sort((a, b) => a.region.w * a.region.h - b.region.w * b.region.h)[0]
  return within ? { kind: 'detail', place, within } : { kind: 'place', place }
}

export const byAreaDescending = (a: CalibrationView, b: CalibrationView) =>
  b.region.w * b.region.h - a.region.w * a.region.h
