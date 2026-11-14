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
    readonly status: 403 | 404 | 409 | 422 | 502 | 503,
    /** The api tier's problem code, when it named one ({@link CAPTURE_REFUSAL_CODES}). */
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'CaptureFetchError'
  }
}

/**
 * Why the api tier refuses a capture, by name (`public_sources.capture`): a URL
 * or a redirect off the source's hosts or onto no public address, a body past
 * the egress ceiling, and the PDF reader's refusals (`public_sources.pdf`).
 */
export const CAPTURE_REFUSAL_CODES = [
  'egress_refused',
  'body_too_large',
  'pdf_encrypted',
  'pdf_malformed',
  'pdf_too_many_pages',
  'pdf_parse_timeout',
  'pdf_reader_failed',
] as const

/** Why the api tier refuses to keep a fetched text in the base corpus, beside a capture's own refusals (`corpus-text`). */
export const TEXT_REFUSAL_CODES = ['not_a_pdf', 'name_taken'] as const

/**
 * How long the BFF waits for the api tier. The longest call is a monitor's probe: two fetches (the page and
 * its terms, at most 45 s each, `public_sources.capture.FETCH_TIMEOUT_SECONDS`) and, for a PDF, one parse
 * (at most 45 s, `public_sources.pdf.PARSE_TIMEOUT_SECONDS`). Longer than all of them together, so a parse past
 * its deadline reaches the door as `PDF_PARSE_TIMEOUT` and not as "the reader did not answer"
 * (`packages/public-sources/tests/test_pdf.py` holds the two tiers to it).
 */
export const CAPTURE_TIMEOUT_MS = 150_000

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
  return pageOf(await guardedFetch('/v1/public-sources/capture', { source: sourceId, url, ...(configured ?? {}) }, 'upload the page as operator_supplied'))
}

/** A PDF the api tier fetched and kept as a base-corpus file (`POST /v1/public-sources/corpus-text`). */
export interface ImportedText extends Omit<FetchedPage, 'text'> {
  fileName: string
  /** Whether the bytes were stored now; false when the base corpus already kept them under this name. */
  stored: boolean
}

/**
 * Fetch the PDF at `url` as the source allows it and keep it in the base
 * corpus. The fetch and the PDF read are the fetcher's, as for a capture;
 * nothing is parsed in this tier or in the api tier. The api tier names the
 * file after `fileStem` and the bytes' hash (`corpus_text_name`), so it never
 * replaces anything: other bytes are another name. Fails closed like
 * {@link fetchSourcePage}; a name that holds other bytes is a 409 with `name_taken`.
 */
export async function importSourceText(text: { sourceId: string; url: string; fileStem: string }, configured?: ConfiguredSource): Promise<ImportedText> {
  const body = await guardedFetch(
    '/v1/public-sources/corpus-text',
    { source: text.sourceId, url: text.url, fileStem: text.fileStem, ...(configured ?? {}) },
    'upload the PDF with platform-knowledge-text-upload',
  )
  const page = pageOf(body)
  const { text: _text, ...facts } = page
  if (!isRecord(body) || typeof body.fileName !== 'string') throw new CaptureFetchError('The public-source reader kept the text without naming its file.', 502)
  return { ...facts, fileName: body.fileName, stored: body.stored === true }
}

/** One guarded fetch on the api tier: its answer's body, or a {@link CaptureFetchError}; `otherwise` is what the caller can do instead. */
async function guardedFetch(path: string, payload: { source: string } & Record<string, unknown>, otherwise: string): Promise<unknown> {
  let answer: { status: number; body: unknown }
  try {
    answer = await callPublicSources(path, payload)
  } catch (error) {
    if (error instanceof CaptureFetchError) throw new CaptureFetchError(`${error.message} Or ${otherwise}.`, error.status)
    throw error
  }
  if (answer.status >= 200 && answer.status < 300) return answer.body
  const detail = refusalDetail(answer)
  // A fetch the api tier refused by name (a host off the source, a body too large, a PDF behind a password): the code says which.
  const code = isRecord(answer.body) && typeof answer.body.code === 'string' ? answer.body.code : null
  if (code && answer.status === 409) throw new CaptureFetchError(detail, 409, code)
  if (code && (answer.status === 403 || answer.status === 422)) throw new CaptureFetchError(`The capture was refused: ${detail}`, 422, code)
  if (answer.status === 403 || answer.status === 400 || answer.status === 422) throw new CaptureFetchError(`The fetch was refused: ${detail}`, 403)
  if (answer.status === 404) throw new CaptureFetchError(`No configured source ${payload.source}: ${detail}`, 404)
  throw new CaptureFetchError(`The source did not answer: ${detail}. Try again, or ${otherwise}.`, 502)
}
