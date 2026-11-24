import 'server-only'
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
    const code = 'noNumber' in answer ? answer.noNumber.code : 'other'
    throw new UnprocessableError(`Nothing to keep: these points give no measurement (${code}).`, {
      field: 'points',
      reason: 'no-number',
      code,
    })
  }
  const { value, unit, low, high, provenance, scaleState, scaleRatio, printed } = answer.measurement
  return keptReadingSchema.parse({ value, unit, low, high, provenance, scaleState, scaleRatio, printed })
}
