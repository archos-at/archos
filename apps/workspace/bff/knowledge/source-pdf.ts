import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { internalServiceHeaders } from '@/lib/internal-auth'
import { NotFoundError, UpstreamError } from '@/lib/api/errors'
import { adminHeaders, KNOWLEDGE_STATUS_TIMEOUT_MS, requirePdfBasename } from './service'

const PDF_NOT_AVAILABLE = 'Source PDF not available'

const OFFICE_CACHE = 'no-store'

async function streamCorpusPdf(name: string, url: string, headers: Record<string, string>, cacheControl: string): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, {
      headers,
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
  const asciiName = name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '_')
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${asciiName}"`,
      'Cache-Control': cacheControl,
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  })
}

export async function streamReleasedKnowledgeBaseDocument(fileName: string, countries: readonly string[]): Promise<Response> {
  const name = requirePdfBasename(fileName)
  if (countries.length === 0) throw new NotFoundError(PDF_NOT_AVAILABLE)
  const backendUrl = getBackendUrl()
  const query = new URLSearchParams(countries.map((country) => ['country', country]))
  return streamCorpusPdf(name, `${backendUrl}/v1/corpus/documents/${encodeURIComponent(name)}?${query}`, internalServiceHeaders(backendUrl), OFFICE_CACHE)
}

export async function streamKnowledgeBaseDocumentAsPlatform(fileName: string): Promise<Response> {
  const name = requirePdfBasename(fileName)
  return streamCorpusPdf(name, `${getBackendUrl()}/v1/admin/corpus/documents/${encodeURIComponent(name)}`, adminHeaders(), 'private, max-age=300')
}
