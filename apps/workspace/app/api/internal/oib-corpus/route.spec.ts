/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn(),
}))

vi.mock('@/lib/knowledge/service', () => ({
  streamKnowledgeBaseCorpus: vi.fn(),
}))

import { GET } from './route'
import { streamKnowledgeBaseCorpus } from '@/lib/knowledge/service'

const request = (token: string | null): Request =>
  new Request('http://localhost/api/internal/oib-corpus', {
    headers: token ? { 'x-grid-internal-token': token } : {},
  })

describe('GET /api/internal/oib-corpus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CORPUS_EXPORT_TOKEN', 'export-token')
    vi.stubEnv('INTERNAL_API_TOKEN', 'service-token')
    vi.stubEnv('APP_ENV', 'development')
  })

  it('streams the corpus for its own token', async () => {
    vi.mocked(streamKnowledgeBaseCorpus).mockResolvedValue(
      new Response('tar', { headers: { 'Content-Type': 'application/gzip' } })
    )
    const res = await GET(request('export-token'))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/gzip')
    expect(await res.text()).toBe('tar')
  })

  it('refuses the shared service token: a leak of one opens only its own routes', async () => {
    expect((await GET(request('service-token'))).status).toBe(403)
    expect((await GET(request(null))).status).toBe(403)
    expect(streamKnowledgeBaseCorpus).not.toHaveBeenCalled()
  })

  it('fails closed when its token is unconfigured', async () => {
    vi.stubEnv('CORPUS_EXPORT_TOKEN', undefined)
    expect((await GET(request('export-token'))).status).toBe(503)
    expect(streamKnowledgeBaseCorpus).not.toHaveBeenCalled()
  })
})
