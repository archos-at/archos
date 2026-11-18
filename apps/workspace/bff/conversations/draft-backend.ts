import 'server-only'
import { getBackendUrl } from '@/lib/backend-proxy'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'
import {
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

export async function fetchDraftFromBackend(
  conversationId: string,
  path: string,
  options: { raw: boolean },
): Promise<Response> {
  const encodedPath = encodedDraftPath(path)

  let tokenHeaders: Record<string, string>
  try {
    tokenHeaders = internalServiceHeaders(getBackendUrl())
  } catch (error) {
    if (error instanceof InternalServiceUnavailableError) throw new ServiceUnavailableError('Draft preview is unavailable')
    throw error
  }

  const url = `${getBackendUrl()}/v1/drafts/${encodeURIComponent(conversationId)}/${encodedPath}${options.raw ? '?raw=true' : ''}`
  let response: Response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: tokenHeaders,
      signal: AbortSignal.timeout(DRAFT_READ_TIMEOUT_MS),
    })
  } catch {
    throw new UpstreamError('Draft preview is unavailable')
  }

  if (!response.ok) {
    if (response.status === 404) throw new NotFoundError()
    if (response.status === 400) throw new BadRequestError('Invalid draft path')
    if (response.status === 413) throw new PayloadTooLargeError()
    throw new UpstreamError(`Draft preview failed with ${response.status}`)
  }
  return response
}
