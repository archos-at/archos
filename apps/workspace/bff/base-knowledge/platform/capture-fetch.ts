/**
 * A page fetched for a citation capture (ADR-0170), through the backend's
 * public-source reader and so through the public-source fetcher (ADR-0162).
 *
 * The bytes are not fetched in this tier: the fetcher's NetworkPolicy admits
 * the backend roles only, and its guard (the configured source's hosts at every
 * redirect, a globally routable address, GET only) lives in
 * `packages/public-sources`. The api tier's `POST /v1/public-sources/capture`
 * makes the request with the same transport every source reader uses and
 * answers the bytes' sha256, their size, and the page's text for the quote
 * check. A host the source does not list is refused there, never here.
 */

import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'

/** The page as the backend fetched it. */
export interface FetchedPage {
  url: string
  finalUrl: string
  contentType: string | null
  sha256: string
  bytes: number
  /** The page's text; null when the bytes hold none the reader can extract (a PDF, an image). */
  text: string | null
  retrievedAt: string
}

/** Why a page could not be captured: the status the door answers and the reason it gives. */
export class CaptureFetchError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 502 | 503,
  ) {
    super(message)
    this.name = 'CaptureFetchError'
  }
}

/** A statute page is large and the source is a third party; a capture is no interactive read. */
const CAPTURE_TIMEOUT_MS = 60_000

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

function pageOf(body: unknown): FetchedPage {
  if (!isRecord(body) || typeof body.sha256 !== 'string' || typeof body.url !== 'string') {
    throw new CaptureFetchError('The public-source reader answered without a capture.', 502)
  }
  return {
    url: body.url,
    finalUrl: typeof body.finalUrl === 'string' ? body.finalUrl : body.url,
    contentType: typeof body.contentType === 'string' ? body.contentType : null,
    sha256: body.sha256,
    bytes: typeof body.bytes === 'number' ? body.bytes : 0,
    text: typeof body.text === 'string' ? body.text : null,
    retrievedAt: typeof body.retrievedAt === 'string' ? body.retrievedAt : new Date().toISOString(),
  }
}

/** Fetch `url` as source `sourceId` allows it. Fails closed: no token, no reader, a refusal, all throw. */
export async function fetchSourcePage(sourceId: string, url: string): Promise<FetchedPage> {
  const base = getBackendUrl()
  let headers: Record<string, string>
  try {
    headers = internalServiceHeaders(base)
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
    throw new CaptureFetchError('The public-source reader is not reachable from here; upload the page as operator_supplied.', 503)
  }
  let response: Response
  try {
    response = await fetch(`${base}/v1/public-sources/capture`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ source: sourceId, url }),
      signal: AbortSignal.timeout(CAPTURE_TIMEOUT_MS),
    })
  } catch {
    throw new CaptureFetchError('The public-source reader did not answer; try again, or upload the page as operator_supplied.', 503)
  }
  const body = (await response.json().catch(() => null)) as unknown
  if (response.ok) return pageOf(body)
  const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : `HTTP ${response.status}`
  if (response.status === 403 || response.status === 400) throw new CaptureFetchError(`The fetch was refused: ${detail}`, 403)
  if (response.status === 404) throw new CaptureFetchError(`No configured source ${sourceId}: ${detail}`, 404)
  throw new CaptureFetchError(`The source did not answer: ${detail}. Try again, or upload the page as operator_supplied.`, 502)
}
