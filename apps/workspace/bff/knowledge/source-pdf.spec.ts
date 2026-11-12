/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/backend-url', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/internal-auth', () => ({ internalServiceHeaders: () => ({ 'x-test-internal-token': 'internal' }) }))

import { NotFoundError, UpstreamError } from '@/lib/api/errors'
import { streamKnowledgeBaseDocumentAsPlatform, streamReleasedKnowledgeBaseDocument } from './source-pdf'

const fetchMock = vi.fn()
const pdf = () => new Response(new Blob([new Uint8Array([37, 80, 68, 70])]), { status: 200 })

function sent(): { url: URL; headers: Record<string, string> } {
  const [url, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
  return { url: new URL(url), headers: init.headers }
}

async function refusal(read: Promise<Response>): Promise<unknown> {
  return read.then(
    () => null,
    (error: unknown) => error,
  )
}

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => pdf())
  vi.stubEnv('ADMIN_TOKEN', 'admin')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('streamReleasedKnowledgeBaseDocument', () => {
  it('asks the backend for the file as a reader of exactly the given countries, with the internal token', async () => {
    await streamReleasedKnowledgeBaseDocument('a text.pdf', ['QA', 'QB'])

    const { url, headers } = sent()
    expect(url.pathname).toBe('/v1/corpus/documents/a%20text.pdf')
    expect(url.searchParams.getAll('country')).toEqual(['QA', 'QB'])
    expect(headers).toEqual({ 'x-test-internal-token': 'internal' })
  })

  it('answers a reader of no country without asking the backend', async () => {
    await expect(streamReleasedKnowledgeBaseDocument('a.pdf', [])).rejects.toBeInstanceOf(NotFoundError)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('answers every file the reader does not get alike, whether the backend or the empty entitlement refused it', async () => {
    fetchMock.mockImplementation(async () => new Response('{"detail":"anything the backend says"}', { status: 404 }))

    const refused = await refusal(streamReleasedKnowledgeBaseDocument('withheld-or-missing.pdf', ['QA']))
    const unentitled = await refusal(streamReleasedKnowledgeBaseDocument('withheld-or-missing.pdf', []))

    expect(refused).toBeInstanceOf(NotFoundError)
    expect((refused as Error).message).toBe((unentitled as Error).message)
    expect((refused as Error).message).not.toContain('withheld-or-missing')
  })

  it('streams the PDF inline and lets the same-origin viewer frame it', async () => {
    // The global next.config rule stamps X-Frame-Options: DENY on every route,
    // which would make the browser refuse to render the same-origin preview
    // iframe. The streamed Response overrides that (defense in depth alongside
    // the route-scoped next.config override).
    const res = await streamReleasedKnowledgeBaseDocument('a.pdf', ['QA'])

    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('inline')
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
    expect(res.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'")
  })

  it('lets no browser keep the PDF, so a withdrawn release stops opening at once', async () => {
    const res = await streamReleasedKnowledgeBaseDocument('a.pdf', ['QA'])

    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('reports a backend that cannot serve a listed file as an upstream failure, not as a missing file', async () => {
    fetchMock.mockImplementation(async () => new Response('store down', { status: 503 }))

    await expect(streamReleasedKnowledgeBaseDocument('a.pdf', ['QA'])).rejects.toBeInstanceOf(UpstreamError)
  })
})

describe('streamKnowledgeBaseDocumentAsPlatform', () => {
  it('reads any file through the admin route, with the admin token and no country', async () => {
    const res = await streamKnowledgeBaseDocumentAsPlatform('draft.pdf')

    const { url, headers } = sent()
    expect(url.pathname).toBe('/v1/admin/corpus/documents/draft.pdf')
    expect(url.search).toBe('')
    expect(headers).toEqual({ 'X-Admin-Token': 'admin' })
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
  })

  it('maps a file the corpus does not list to NotFoundError', async () => {
    fetchMock.mockImplementation(async () => new Response('nope', { status: 404 }))

    await expect(streamKnowledgeBaseDocumentAsPlatform('gone.pdf')).rejects.toBeInstanceOf(NotFoundError)
  })
})
