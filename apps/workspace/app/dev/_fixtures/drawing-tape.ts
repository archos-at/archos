/**
 * Fixed states of the person's tape for `/dev/drawing-tape` (ADR-0182, slice 8).
 *
 * Every number stands in for an answer of the measuring engine; none is
 * computed here. The refusal's reason and remedy are the engine's own words
 * (`agent.drawings.sheet_measure._unscaled`, `sheet_answers.CONFIRM_THE_SCALE`),
 * which the review shows as given.
 */

import type { AnnotationView } from '@/lib/annotations/types'
import type { PagePoint } from '@/lib/annotations/measure-shapes'
import { IDLE_TAPE, type SheetTape } from '@/features/documents/hooks/use-sheet-tape'

const IN_HAND: SheetTape = { ...IDLE_TAPE, available: true, page: 1 }

/** The corridor's length along the middle wall, on a sheet whose scale the sheet's own dimensions corroborate. */
export const DISTANCE_ESTIMATED: SheetTape = {
  ...IN_HAND,
  tool: 'distance',
  points: [[0.12, 0.5], [0.62, 0.5]],
  reading: {
    quantity: 'distance',
    value: 7.385,
    unit: 'm',
    low: 7.348,
    high: 7.422,
    provenance: 'vector_estimated',
    scaleState: 'estimated',
    scaleRatio: 100,
    verdict: null,
    reasons: [],
    points: [[0.12, 0.5], [0.62, 0.5]],
  },
}

/** The first room, its four corners in order, in a region a person calibrated. */
export const AREA_VERIFIED: SheetTape = {
  ...IN_HAND,
  tool: 'area',
  points: [[0.12, 0.2], [0.44, 0.2], [0.44, 0.5], [0.12, 0.5]],
  reading: {
    quantity: 'area',
    value: 17.64,
    unit: 'm2',
    low: 17.569,
    high: 17.711,
    provenance: 'vector_verified',
    scaleState: 'verified',
    scaleRatio: 50,
    verdict: null,
    reasons: [],
    points: [[0.12, 0.2], [0.44, 0.2], [0.44, 0.5], [0.12, 0.5]],
  },
}

/** Two corners in a region with no scale a number may rest on. */
export const REFUSED_UNCALIBRATED: SheetTape = {
  ...IN_HAND,
  tool: 'distance',
  points: [[0.62, 0.5], [0.62, 0.8]],
  refusal: {
    reason: 'this region has no usable scale (the sheet prints two different scale notes and stores no region)',
    remedy: 'ask a person to confirm the scale of this region (a calibration), then measure again',
    scaleState: 'uncalibrated',
    candidates: [],
  },
}

/** A click between a wall's end and a lining a few centimetres inside it. */
export const SEVERAL_IN_REACH: SheetTape = {
  ...IN_HAND,
  tool: 'path',
  points: [[0.12, 0.8]],
  miss: { page: 1, at: [0.875, 0.79], reason: 'several', candidates: [[0.88, 0.8], [0.865, 0.8]] },
}

const mark = (number: number, extra: Partial<AnnotationView> & { points: PagePoint[] }): AnnotationView => ({
  id: `kept-${number}`,
  documentId: 'doc-tape',
  number,
  page: 1,
  shape: 'line',
  x: extra.points[0][0],
  y: extra.points[0][1],
  w: null,
  h: null,
  kind: 'hint',
  body: 'Strecke',
  mentions: [],
  basis: null,
  authorKind: 'person',
  status: 'open',
  assigneeUserId: null,
  assigneeName: null,
  dueOn: null,
  revisionNumber: 2,
  onCurrentRevision: true,
  createdBy: 'user_1',
  createdByName: 'Anna Berger',
  createdAt: '2026-11-10T09:00:00.000Z',
  updatedAt: '2026-11-10T09:00:00.000Z',
  acceptedBy: null,
  acceptedByName: null,
  closedBy: null,
  closedByName: null,
  closedAt: null,
  delegatedBy: null,
  delegatedByName: null,
  delegatedAt: null,
  canEdit: true,
  canDelete: true,
  replies: [],
  ...extra,
})

/** Three measurements kept on the sheet: a width, a room's area, and a path round a corner. */
export const KEPT_MARKS: AnnotationView[] = [
  mark(1, {
    body: 'Flurbreite',
    points: [[0.44, 0.2], [0.44, 0.5]],
    measurement: { value: 3, unit: 'm', low: 2.985, high: 3.015, provenance: 'vector_estimated', scaleState: 'estimated' },
  }),
  mark(2, {
    shape: 'polygon',
    body: 'Zimmer 2, Fläche',
    points: [[0.62, 0.5], [0.88, 0.5], [0.88, 0.8], [0.62, 0.8]],
    measurement: { value: 16.5, unit: 'm2', low: 16.434, high: 16.566, provenance: 'vector_verified', scaleState: 'verified' },
  }),
  mark(3, {
    shape: 'path',
    body: 'Weg zur Tür',
    points: [[0.12, 0.8], [0.12, 0.5], [0.3, 0.5]],
    measurement: { value: 6.42, unit: 'm', low: 6.388, high: 6.452, provenance: 'vector_estimated', scaleState: 'estimated' },
  }),
]
