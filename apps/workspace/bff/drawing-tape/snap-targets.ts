import 'server-only'
import { kindOf } from '@/lib/conversation-context/types'
import { createHash } from 'node:crypto'
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
import { listDrawingCalibrations } from '@/lib/drawing-calibrations/repository'
import { isPdfDocument } from '@/lib/drawing-calibrations/service'
import { MAX_PAGE_CALIBRATIONS } from '@/lib/drawing-calibrations/wire'
import { toPageCalibration } from '@/lib/drawing-calibrations/page-read'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import { signedEnvelopeHeaders } from '@/lib/turns/signed-envelope'
import { TurnBudgetExhaustedError } from '@/lib/turns/turn-context'
import { shelfReaderFor } from '@/lib/upload-screening/quarantine-reviewers'
import { snapTargetsResponseSchema, type SnapTargetsResponse } from './snap-wire'

const BACKEND_SNAP_TARGETS_PATH = '/v1/internal/drawing-snap-targets'
const BACKEND_SNAP_TARGETS_TIMEOUT_MS = 125_000

async function backendHeaders(session: AuthorizedSession, document: Document, base: string) {
  const secret = process.env.INTERNAL_API_TOKEN
  let token: Record<string, string>
  try {
    token = internalServiceHeaders(base)
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
    throw new ServiceUnavailableError('The measuring service is not configured')
  }
  if (!secret) throw new ServiceUnavailableError('The measuring service is not configured')
  try {
    return {
      ...(await signedEnvelopeHeaders(session, document.projectId ?? undefined, secret, kindOf(null, 'ui'))),
      ...token,
    }
  } catch (error) {
    if (error instanceof TurnBudgetExhaustedError)
      throw new ApiError(429, 'BUDGET_EXHAUSTED', error.message)
    if (isAuthzRefusal(error)) throw new ForbiddenError('You cannot measure on this document')
    throw error
  }
}

async function askEngine(
  session: AuthorizedSession,
  document: Document,
  page: number
): Promise<SnapTargetsResponse> {
  const base = getBackendUrl()
  const headers = await backendHeaders(session, document, base)
  let response: Response
  try {
    response = await fetch(`${base}${BACKEND_SNAP_TARGETS_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({
        file_name: document.filename,
        collection: document.collectionName,
        page,
        stated_kinds: ['pdf'],
      }),
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(BACKEND_SNAP_TARGETS_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof ApiError) throw error
    throw new UpstreamError('The measuring service could not be reached')
  }
  if (!response.ok)
    throw new UpstreamError(`The measuring service answered HTTP ${response.status}`)
  const parsed = snapTargetsResponseSchema.safeParse(await response.json().catch(() => null))
  if (!parsed.success)
    throw new UpstreamError('The measuring service answered in a form this build does not read')
  return parsed.data
}

async function pageTag(
  session: AuthorizedSession,
  document: Document,
  versionId: string,
  page: number
) {
  const rows = await listDrawingCalibrations(
    {
      organizationId: session.organizationId,
      documentId: document.id,
      versionId,
      page,
      status: 'active',
    },
    await shelfReaderFor(session, document),
    { limit: MAX_PAGE_CALIBRATIONS, offset: 0 }
  )
  const calibrations = rows.slice(0, MAX_PAGE_CALIBRATIONS).map(toPageCalibration)
  const digest = createHash('sha256')
    .update(JSON.stringify(calibrations))
    .digest('base64url')
    .slice(0, 16)
  return `"${versionId}.${page}.${digest}"`
}

export async function snapTargetsOfDocument(
  session: AuthorizedSession,
  documentId: string,
  page: number,
  ifNoneMatch: string | null
): Promise<Response> {
  if (!isDrawingMeasureEnabled(session))
    throw new FeatureDisabledError(FEATURE_FLAGS.drawingMeasure)
  const document = await getAccessibleDocument(session, documentId, 'read')
  const versionId = document.publishedVersionId
  if (!versionId || !isPdfDocument(document)) {
    throw new UnprocessableError('Only a PDF drawing is measured.', {
      field: 'document',
      reason: 'not-a-pdf',
    })
  }
  const tag = await pageTag(session, document, versionId, page)
  const cached = { 'Cache-Control': 'private, no-cache', ETag: tag }
  if (ifNoneMatch === tag) return new Response(null, { status: 304, headers: cached })
  const answer = await askEngine(session, document, page)
  const headers = 'targets' in answer ? cached : { 'Cache-Control': 'no-store' }
  return Response.json(answer, { headers })
}
