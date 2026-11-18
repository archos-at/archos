import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import {
  ApiError,
  BadRequestError,
  NotFoundError,
  PayloadTooLargeError,
  ServiceUnavailableError,
  UpstreamError,
} from '@/lib/api/errors'

const DRAFT_READ_TIMEOUT_MS = 10_000

const MAX_DRAFT_PATH_CHARS = 500

export function encodedDraftPath(path: string): string {
  const trimmed = path.trim()
  if (!trimmed || trimmed.length > MAX_DRAFT_PATH_CHARS) throw new BadRequestError('Invalid draft path')
  const stripped = trimmed.replace(/^\/+/, '')
  if (!stripped) throw new BadRequestError('Invalid draft path')
  return stripped
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

function backendHeaders(): Record<string, string> {
  try {
    return internalServiceHeaders(getBackendUrl())
  } catch (error) {
    if (error instanceof InternalServiceUnavailableError) throw new ServiceUnavailableError('Draft preview is unavailable')
    throw error
  }
}

async function callBackend(url: string, init: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(DRAFT_READ_TIMEOUT_MS) })
  } catch {
    throw new UpstreamError('Draft preview is unavailable')
  }
  if (!response.ok) {
    if (response.status === 404) throw new NotFoundError()
    if (response.status === 400) throw new BadRequestError('Invalid draft path')
    if (response.status === 410) {
      throw new ApiError(410, 'DRAFT_VERSION_GONE', 'This version of the draft is no longer kept', { reason: 'version-gone' })
    }
    if (response.status === 413) throw new PayloadTooLargeError()
    throw new UpstreamError(`Draft preview failed with ${response.status}`)
  }
  return response
}

const draftsUrl = (conversationId: string): string => `${getBackendUrl()}/v1/drafts/${encodeURIComponent(conversationId)}`

export async function fetchDraftFromBackend(
  conversationId: string,
  path: string,
  options: { raw: boolean; version?: number },
): Promise<Response> {
  const encodedPath = encodedDraftPath(path)
  const query = options.raw ? `?raw=true${options.version ? `&version=${options.version}` : ''}` : ''
  return callBackend(`${draftsUrl(conversationId)}/${encodedPath}${query}`, { method: 'GET', headers: backendHeaders() })
}

export interface DraftFilingRecord {
  documentId: string
  versionId: string
  contentHash: string
  state: string
  draftVersion: number
}

export async function recordDraftFilingInBackend(
  conversationId: string,
  path: string,
  record: DraftFilingRecord,
): Promise<void> {
  const absolute = `/${encodedDraftPath(path)}`
  await callBackend(`${draftsUrl(conversationId)}/filing?path=${encodeURIComponent(decodeURIComponent(absolute))}`, {
    method: 'PUT',
    headers: { ...backendHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  })
}

export async function restoreDraftInBackend(conversationId: string, path: string): Promise<number> {
  const absolute = `/${encodedDraftPath(path)}`
  const response = await callBackend(
    `${draftsUrl(conversationId)}/restore?path=${encodeURIComponent(decodeURIComponent(absolute))}`,
    { method: 'POST', headers: backendHeaders() },
  )
  const body: unknown = await response.json().catch(() => null)
  const version = typeof body === 'object' && body !== null && 'version' in body ? Number(body.version) : NaN
  if (!Number.isInteger(version) || version < 1) throw new UpstreamError('Draft restore answered unexpectedly')
  return version
}

export async function deleteDraftInBackend(conversationId: string, path: string): Promise<void> {
  await callBackend(`${draftsUrl(conversationId)}/${encodedDraftPath(path)}`, { method: 'DELETE', headers: backendHeaders() })
}
