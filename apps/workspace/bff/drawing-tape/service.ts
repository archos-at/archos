import { kindOf } from '@/lib/conversation-context/types'
import 'server-only'
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

const BACKEND_TAPE_PATH = '/v1/internal/drawing-tape'
const BACKEND_TAPE_TIMEOUT_MS = 125_000

async function envelopeFor(session: AuthorizedSession, document: Document, secret: string) {
  try {
    return await signedEnvelopeHeaders(session, document.projectId ?? undefined, secret, kindOf(null, 'ui'))
  } catch (error) {
    if (error instanceof TurnBudgetExhaustedError) throw new ApiError(429, 'BUDGET_EXHAUSTED', error.message)
    if (isAuthzRefusal(error)) throw new ForbiddenError('You cannot measure on this document')
    throw error
  }
}

function backendHeaders(base: string): { token: Record<string, string>; secret: string } {
  const secret = process.env.INTERNAL_API_TOKEN
  try {
    const token = internalServiceHeaders(base)
    if (secret) return { token, secret }
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
  }
  throw new ServiceUnavailableError('The measuring service is not configured')
}

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
  const { token, secret } = backendHeaders(base)
  const envelope = await envelopeFor(session, document, secret)
  let response: Response
  try {
    response = await fetch(`${base}${BACKEND_TAPE_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...envelope, ...token },
      body: JSON.stringify({
        file_name: document.filename,
        collection: document.collectionName,
        page: request.page,
        operation: request.operation,
        points: request.points,
        stated_kinds: ['pdf'],
      }),
      cache: 'no-store',
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

export async function measureOnDocument(
  session: AuthorizedSession,
  documentId: string,
  input: MeasureRequest
): Promise<MeasureResponse> {
  const request = measureRequestSchema.parse(input)
  if (!isDrawingMeasureEnabled(session)) throw new FeatureDisabledError(FEATURE_FLAGS.drawingMeasure)
  const document = await getAccessibleDocument(session, documentId, 'read')
  return measureOnReadDocument(session, document, request)
}
