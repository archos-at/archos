/**
 * A mark as the repository stores it, from what a request or a proposal
 * carries (`service.ts`): a point has no size, a region has one, and a kept
 * measurement has its points and the reading the engine answered for them
 * (`./measure-shapes.ts`).
 */

import { isMeasureShape, type KeptReading, type PagePoint } from './measure-shapes'
import type { NewAnnotationValues } from './repository'
import type { MarkMention } from './types'

export const toMark = (input: {
  page: number
  shape: NewAnnotationValues['shape']
  x: number
  y: number
  w?: number | null
  h?: number | null
  points?: PagePoint[] | null
  /** What the engine answered for `points` (`lib/drawing-tape/kept-reading.ts`); never a caller's number. */
  measurement?: KeptReading | null
  kind: NewAnnotationValues['kind']
  body: string
  mentions?: MarkMention[]
  basis?: string | null
  assigneeUserId?: string | null
  dueOn?: string | null
}): NewAnnotationValues => ({
  page: input.page,
  shape: input.shape,
  x: input.x,
  y: input.y,
  w: input.shape === 'region' ? (input.w ?? null) : null,
  h: input.shape === 'region' ? (input.h ?? null) : null,
  points: isMeasureShape(input.shape) ? (input.points ?? null) : null,
  measurement: isMeasureShape(input.shape) ? (input.measurement ?? null) : null,
  kind: input.kind,
  body: input.body,
  mentions: input.mentions ?? [],
  basis: input.basis ?? null,
  assigneeUserId: input.assigneeUserId ?? null,
  dueOn: input.dueOn ?? null,
})
