import 'server-only'
/**
 * What a kept measurement stores: the engine's answer for the mark's points at
 * the moment it is kept (ADR-0182, slice 8).
 *
 * The create request carries the shape and its points and no number. This
 * asks the engine for exactly those points on the document's current version
 * and keeps the value, its interval, its provenance and the scale state it
 * answered. So the number on the sheet is never the caller's: a browser, or an
 * outside agent through `annotation-create`, cannot store one the engine did
 * not give. Where the engine gives no number, nothing is kept and the refusal
 * carries its reason and remedy.
 */

import { UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import {
  isMeasureShape,
  keptReadingSchema,
  MEASURE_OPERATION_OF,
  type KeptReading,
  type PagePoint,
} from '@/lib/annotations/measure-shapes'
import type { Document } from '@/lib/db/schema/documents'
import { measureOnReadDocument } from './service'

/** The reading to store with a new mark: null for a pin, the engine's answer for a measurement. */
export async function keptReadingFor(
  session: AuthorizedSession,
  document: Document,
  mark: { page: number; shape: string; points?: PagePoint[] | null }
): Promise<KeptReading | null> {
  if (!isMeasureShape(mark.shape)) return null
  const answer = await measureOnReadDocument(session, document, {
    page: mark.page,
    operation: MEASURE_OPERATION_OF[mark.shape],
    points: mark.points ?? [],
  })
  if (!('measurement' in answer)) {
    const refused = 'noNumber' in answer ? answer.noNumber : null
    throw new UnprocessableError(
      refused ? `Nothing to keep: ${refused.reason}. ${refused.remedy}`.trim() : 'Nothing to keep: no measurement.',
      { field: 'points', reason: 'no-number' }
    )
  }
  const { value, unit, low, high, provenance, scaleState } = answer.measurement
  return keptReadingSchema.parse({ value, unit, low, high, provenance, scaleState })
}
