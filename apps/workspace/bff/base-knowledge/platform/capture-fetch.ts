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
 * check: a PDF's text is ingestion's text pass over its pages, the text the
 * corpus indexes. A host the source does not list is refused there, never here.
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
  /** The page's text; null when the bytes hold none the reader can extract (an image, a scanned PDF). A PDF's pages are joined by a form feed. */
  text: string | null
  /** A PDF's pages; null for a page that has none. */
  pages: number | null
  /** What a reader of `text` must know, e.g. which pages of a PDF have no text layer; null when nothing. */
  note: string | null
  retrievedAt: string
}

/** Why a page could not be captured: the status the door answers and the reason it gives. */
export class CaptureFetchError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 422 | 502 | 503,
    /** The api tier's problem code, when it named one: `pdf_encrypted`, `pdf_malformed`, `pdf_too_many_pages`, `pdf_parse_timeout`. */
    readonly code: string | null = null,
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
    pages: typeof body.pages === 'number' ? body.pages : null,
    note: typeof body.note === 'string' && body.note ? body.note : null,
    retrievedAt: typeof body.retrievedAt === 'string' ? body.retrievedAt : new Date().toISOString(),
  }
}

/** A source configured in the database (ADR-0174), whole, with its key when it is keyed. */
export interface ConfiguredSource {
  config: Record<string, unknown>
  credential?: string
}

/**
 * POST to one of the api tier's public-source routes. Fails closed: no token,
 * no reader, no answer, all throw a {@link CaptureFetchError}; a refusal keeps
 * the status the route gave.
 */
export async function callPublicSources(path: string, body: unknown, timeoutMs = CAPTURE_TIMEOUT_MS): Promise<{ status: number; body: unknown }> {
  const base = getBackendUrl()
  let headers: Record<string, string>
  try {
    headers = internalServiceHeaders(base)
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
    throw new CaptureFetchError('The public-source reader is not reachable from here.', 503)
  }
  let response: Response
  try {
    response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    throw new CaptureFetchError('The public-source reader did not answer; try again.', 503)
  }
  return { status: response.status, body: (await response.json().catch(() => null)) as unknown }
}

/** The detail an api-tier refusal carries (FastAPI's `detail`), or its status. */
export function refusalDetail(answer: { status: number; body: unknown }): string {
  return isRecord(answer.body) && typeof answer.body.detail === 'string' ? answer.body.detail : `HTTP ${answer.status}`
}

/**
 * Fetch `url` as the source allows it: a repository record by its id, or a
 * configured source (`configured`, ADR-0174) whose hosts the caller has
 * already found registered for this use. Fails closed: no token, no reader, a
 * refusal, all throw.
 */
export async function fetchSourcePage(sourceId: string, url: string, configured?: ConfiguredSource): Promise<FetchedPage> {
  let answer: { status: number; body: unknown }
  try {
    answer = await callPublicSources('/v1/public-sources/capture', { source: sourceId, url, ...(configured ?? {}) })
  } catch (error) {
    if (error instanceof CaptureFetchError) throw new CaptureFetchError(`${error.message} Or upload the page as operator_supplied.`, error.status)
    throw error
  }
  if (answer.status >= 200 && answer.status < 300) return pageOf(answer.body)
  const detail = refusalDetail(answer)
  // A body the reader refused by name (a PDF behind a password, a broken one): the code says which.
  const code = isRecord(answer.body) && typeof answer.body.code === 'string' ? answer.body.code : null
  if (answer.status === 422 && code) throw new CaptureFetchError(`The page cannot be read: ${detail}`, 422, code)
  if (answer.status === 403 || answer.status === 400 || answer.status === 422) throw new CaptureFetchError(`The fetch was refused: ${detail}`, 403)
  if (answer.status === 404) throw new CaptureFetchError(`No configured source ${sourceId}: ${detail}`, 404)
  throw new CaptureFetchError(`The source did not answer: ${detail}. Try again, or upload the page as operator_supplied.`, 502)
}
