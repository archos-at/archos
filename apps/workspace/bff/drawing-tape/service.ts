import 'server-only'
/**
 * The person's tape on a PDF drawing (ADR-0182, slice 8): the review view asks
 * here, and the answer is the engine's, for the document's current version.
 *
 * Three gates, in this order, before anything leaves this tier:
 *
 *   1. the `drawing-measure` entitlement of the person's session (off: the
 *      route refuses and the review view shows no tape);
 *   2. read access to the document (`getAccessibleDocument`), which is also
 *      what keeps a document the reader may not see a 404;
 *   3. the file is a PDF.
 *
 * Then the call goes to the backend's `POST /v1/internal/drawing-tape` with
 * the internal token and the person's signed envelope for the document's
 * project (`signedEnvelopeHeaders`): the backend finds the bytes through the
 * BFF's scoped lookup under that envelope, so the CURRENT version's object is
 * the one read. The body states the kind `pdf`: the engine's own gate refuses a
 * call nobody stated a PDF for, and this tier, having checked the entitlement,
 * is the one that may state it, as it does for a chat turn's context.
 *
 * The answer is validated against the wire schema and passed through
 * unchanged: no value is computed, rounded or converted here.
 */

import {
  ApiError,
  ForbiddenError,
  ServiceUnavailableError,
  UnprocessableError,
  UpstreamError,
  isAuthzRefusal,
} from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { FeatureDisabledError } from '@/lib/authz/feature-disabled-error'
import { FEATURE_FLAGS, isDrawingMeasureEnabled } from '@/lib/authz/feature-flags'
import { getBackendUrl } from '@/lib/backend-url'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import { signedEnvelopeHeaders } from '@/lib/turns/signed-envelope'
import { TurnBudgetExhaustedError } from '@/lib/turns/turn-context'
import { isTapeDocument, measureRequestSchema, measureResponseSchema, type MeasureRequest, type MeasureResponse } from './wire'

/** Where the backend serves the tape (`agent_host.routes.drawing_tape`). */
const BACKEND_TAPE_PATH = '/v1/internal/drawing-tape'
/** The engine bounds one answer at 30 s and a page read at 90 s; this is the backstop behind both. */
const BACKEND_TAPE_TIMEOUT_MS = 125_000

async function envelopeFor(session: AuthorizedSession, document: Document, secret: string) {
  try {
    return await signedEnvelopeHeaders(session, document.projectId ?? undefined, secret)
  } catch (error) {
    if (error instanceof TurnBudgetExhaustedError) throw new ApiError(429, 'BUDGET_EXHAUSTED', error.message)
    if (isAuthzRefusal(error)) throw new ForbiddenError('You cannot measure on this document')
    throw error
  }
}

/**
 * Ask the engine about `document`, which the caller has read for this session.
 * Refuses without the entitlement (403, `feature_disabled`) and for a file
 * that is no PDF (422).
 */
export async function measureOnReadDocument(
  session: AuthorizedSession,
  document: Document,
  request: MeasureRequest
): Promise<MeasureResponse> {
  if (!isDrawingMeasureEnabled(session)) throw new FeatureDisabledError(FEATURE_FLAGS.drawingMeasure)
  if (!isTapeDocument(document)) {
    throw new UnprocessableError('Only a PDF drawing is measured.', { field: 'document', reason: 'not-a-pdf' })
  }
  const base = getBackendUrl()
  const secret = process.env.INTERNAL_API_TOKEN
  let tokenHeaders: Record<string, string>
  try {
    tokenHeaders = internalServiceHeaders(base)
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
    throw new ServiceUnavailableError('The measuring service is not configured')
  }
  if (!secret) throw new ServiceUnavailableError('The measuring service is not configured')
  const envelope = await envelopeFor(session, document, secret)

  let response: Response
  try {
    response = await fetch(`${base}${BACKEND_TAPE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...envelope, ...tokenHeaders },
      body: JSON.stringify({
        file_name: document.filename,
        collection: document.collectionName,
        page: request.page,
        operation: request.operation,
        points: request.points,
        // The entitlement was checked above; the engine's gate asks for exactly this statement.
        stated_kinds: ['pdf'],
      }),
      cache: 'no-store',
      // A redirect would replay the internal token at whatever host the response names.
      redirect: 'error',
      signal: AbortSignal.timeout(BACKEND_TAPE_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new UpstreamError('The measuring service could not be reached')
  }
  if (!response.ok) throw new UpstreamError(`The measuring service answered HTTP ${response.status}`)
  const parsed = measureResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new UpstreamError('The measuring service answered in a form this build does not read')
  return parsed.data
}

/** The route's service: measure or snap on a document this session may read. */
export async function measureOnDocument(
  session: AuthorizedSession,
  documentId: string,
  input: MeasureRequest
): Promise<MeasureResponse> {
  const request = measureRequestSchema.parse(input)
  // The entitlement first: without it the route says nothing about any document.
  if (!isDrawingMeasureEnabled(session)) throw new FeatureDisabledError(FEATURE_FLAGS.drawingMeasure)
  const document = await getAccessibleDocument(session, documentId, 'read')
  return measureOnReadDocument(session, document, request)
}
