import 'server-only'
import { getBackendUrl } from '@/lib/backend-url'
import { InternalServiceUnavailableError, internalServiceHeaders } from '@/lib/internal-auth'

export interface RisDocument {
  url: string
  title: string
  text: string
  truncated: boolean
}

const RIS_FETCH_TIMEOUT_MS = 20_000

export class RisDocumentUnavailableError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'RisDocumentUnavailableError'
  }
}

export async function fetchRisDocument(
  reference: string,
  application?: string,
  passage?: string
): Promise<RisDocument> {
  const base = getBackendUrl()
  let tokenHeaders: Record<string, string>
  try {
    tokenHeaders = internalServiceHeaders(base)
  } catch (error) {
    if (!(error instanceof InternalServiceUnavailableError)) throw error
    console.warn(`[RIS] ${error.message}`)
    throw new RisDocumentUnavailableError('RIS is not reachable right now', 503)
  }
  const headers: Record<string, string> = { Accept: 'application/json', ...tokenHeaders }

  const params = new URLSearchParams({ reference })
  if (application) params.set('application', application)
  if (passage) params.set('passage', passage.slice(0, 2000))

  const response = await fetch(`${base}/v1/ris/document?${params.toString()}`, {
    headers,
    cache: 'no-store',
    redirect: 'error',
    signal: AbortSignal.timeout(RIS_FETCH_TIMEOUT_MS),
  })

  if (response.status === 400) {
    throw new RisDocumentUnavailableError('This RIS reference cannot be read', 404)
  }
  if (!response.ok) {
    throw new RisDocumentUnavailableError('RIS is not reachable right now', 502)
  }

  const body = (await response.json()) as Partial<RisDocument>
  if (typeof body.text !== 'string' || body.text.trim() === '') {
    throw new RisDocumentUnavailableError('This RIS reference cannot be read', 404)
  }
  return {
    url: typeof body.url === 'string' && body.url ? body.url : reference,
    title: typeof body.title === 'string' ? body.title : '',
    text: body.text,
    truncated: body.truncated === true,
  }
}
