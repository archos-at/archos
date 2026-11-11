/**
 * The source PDF of a base-corpus file, fetched from the backend for the
 * same-origin viewer. Two reads, and they do not meet: an office's, which the
 * backend answers only for a file released in one of the office's countries
 * (ADR-0173), and the platform operator's, which reads any file the corpus
 * lists. Who the reader is, and which countries are theirs, is the caller's to
 * decide (`released-corpus.ts`, a `platformApiRoute`).
 */

import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { NotFoundError, UpstreamError } from '@/lib/api/errors'
import { adminHeaders, KNOWLEDGE_STATUS_TIMEOUT_MS, requirePdfBasename } from './service'

/** One answer for every PDF this reader does not get: a name cannot tell whether the file exists. */
const PDF_NOT_AVAILABLE = 'Source PDF not available'

/**
 * An office's read is never kept by the browser: a release can be rolled back or an entitlement withdrawn,
 * and a cached copy would go on opening for as long as it lived.
 */
const OFFICE_CACHE = 'no-store'

/** Fetch a corpus PDF from `url` and hand it on for the same-origin viewer; 404 as `PDF_NOT_AVAILABLE`. */
async function streamCorpusPdf(name: string, url: string, headers: Record<string, string>, cacheControl: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      headers,
      // Corpus source PDFs are small; bound the call so an
      // unreachable backend rejects promptly instead of hanging the viewer.
      signal: AbortSignal.timeout(KNOWLEDGE_STATUS_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UpstreamError('Knowledge backend unreachable', error instanceof Error ? error.message : undefined)
  }
  if (res.status === 404) {
    throw new NotFoundError(PDF_NOT_AVAILABLE)
  }
  if (!res.ok || !res.body) {
    throw new UpstreamError(`Knowledge backend returned ${res.status}`)
  }
  // ASCII-safe filename for the header; the viewer only needs inline display.
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_')
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${asciiName}"`,
      'Cache-Control': cacheControl,
      // The in-app viewer renders this stream in a same-origin iframe. The
      // global next.config rule sets X-Frame-Options: DENY on every route;
      // override it here (with a matching CSP frame-ancestors directive for
      // modern browsers) so the preview is allowed to frame. next.config also
      // carries a route-scoped override for these paths; these headers keep the
      // guarantee on the Response itself.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  })
}

/**
 * A corpus source PDF for a reader of `countries` (the citation and source
 * viewer): served only when a release marked the file with one of them
 * (ADR-0173). The backend holds the mark and compares
 * (`corpus_store.released_to`); the countries are the caller's to decide
 * (`released-corpus.ts`). Every other file, and a file that does not exist,
 * is the same 404. A reader of no country is answered without asking.
 */
export async function streamReleasedKnowledgeBaseDocument(fileName: string, countries: readonly string[]): Promise<Response> {
  const name = requirePdfBasename(fileName)
  if (countries.length === 0) throw new NotFoundError(PDF_NOT_AVAILABLE)
  const backendUrl = getBackendUrl()
  const query = new URLSearchParams(countries.map((country) => ['country', country]))
  return streamCorpusPdf(name, `${backendUrl}/v1/corpus/documents/${encodeURIComponent(name)}?${query}`, internalServiceHeaders(backendUrl), OFFICE_CACHE)
}

/**
 * Any corpus PDF, released or not: the platform operator's read. Platform
 * authorization happens in the caller (a `platformApiRoute`, `readPlatformText`).
 */
export async function streamKnowledgeBaseDocumentAsPlatform(fileName: string): Promise<Response> {
  const name = requirePdfBasename(fileName)
  return streamCorpusPdf(name, `${getBackendUrl()}/v1/admin/corpus/documents/${encodeURIComponent(name)}`, adminHeaders(), 'private, max-age=300')
}
