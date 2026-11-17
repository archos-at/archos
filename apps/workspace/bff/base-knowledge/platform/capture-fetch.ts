import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'

export interface FetchedPage {
  url: string
  finalUrl: string
  contentType: string | null
  sha256: string
  bytes: number
  text: string | null
  pages: number | null
  note: string | null
  retrievedAt: string
}

export class CaptureFetchError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 404 | 409 | 422 | 502 | 503,
    readonly code: string | null = null,
  ) {
    super(message)
    this.name = 'CaptureFetchError'
  }
}

export const CAPTURE_REFUSAL_CODES = [
  'egress_refused',
  'body_too_large',
  'pdf_encrypted',
  'pdf_malformed',
  'pdf_too_many_pages',
  'pdf_parse_timeout',
  'pdf_reader_failed',
] as const

export const TEXT_REFUSAL_CODES = ['not_a_pdf', 'name_taken'] as const

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

export interface ConfiguredSource {
  config: Record<string, unknown>
  credential?: string
}

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

export function refusalDetail(answer: { status: number; body: unknown }): string {
  return isRecord(answer.body) && typeof answer.body.detail === 'string' ? answer.body.detail : `HTTP ${answer.status}`
}

export async function fetchSourcePage(sourceId: string, url: string, configured?: ConfiguredSource): Promise<FetchedPage> {
  return pageOf(await guardedFetch('/v1/public-sources/capture', { source: sourceId, url, ...(configured ?? {}) }, 'upload the page as operator_supplied'))
}

export interface ImportedText extends Omit<FetchedPage, 'text'> {
  fileName: string
  stored: boolean
}

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
  const code = isRecord(answer.body) && typeof answer.body.code === 'string' ? answer.body.code : null
  if (code && answer.status === 409) throw new CaptureFetchError(detail, 409, code)
  if (code && (answer.status === 403 || answer.status === 422)) throw new CaptureFetchError(`The capture was refused: ${detail}`, 422, code)
  if (answer.status === 403 || answer.status === 400 || answer.status === 422) throw new CaptureFetchError(`The fetch was refused: ${detail}`, 403)
  if (answer.status === 404) throw new CaptureFetchError(`No configured source ${payload.source}: ${detail}`, 404)
  throw new CaptureFetchError(`The source did not answer: ${detail}. Try again, or ${otherwise}.`, 502)
}
