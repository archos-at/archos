/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Sever the workos-authkit import chain pulled in via backend-proxy.
vi.mock('@/lib/backend-proxy', () => ({
  getBackendUrl: vi.fn().mockReturnValue('http://backend:8000'),
}))

import { BadRequestError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import {
  deleteKnowledgeBaseDocument,
  getKnowledgeBaseStatus,
  getReleasedKnowledgeBaseStatus,
  reingestKnowledgeBaseDocuments,
  syncKnowledgeBase,
  uploadKnowledgeBaseDocument,
  withdrawCorpusFile,
} from './service'

const fetchMock = vi.fn()

const backendPayload = {
  collection_name: 'oib_knowledge',
  collection_exists: true,
  collection_updated_at: '2026-07-01T00:00:00Z',
  summary: {
    total_files: 2,
    ingested: 1,
    stale: 0,
    pending: 1,
    failed: 0,
    removed: 0,
    inconsistent: 0,
    total_chunks: 42,
  },
  files: [
    {
      file_name: 'oib-rl_1_ausgabe_mai_2023.pdf',
      state: 'ingested',
      size_bytes: 1234,
      chunk_count: 42,
      ingested_sha256: 'abc',
      current_sha256: 'abc',
      country_id: 'AT',
      ingested_at: '2026-06-30T12:00:00Z',
      summary: 'Brandschutz.',
      display_title: 'OIB-Richtlinie 1, Ausgabe Mai 2023',
      doc_class_suggestion: 'oib_guideline',
    },
    {
      file_name: 'new.pdf',
      state: 'pending',
      size_bytes: 99,
      chunk_count: 0,
      ingested_sha256: null,
      current_sha256: 'def',
      ingested_at: null,
      summary: null,
    },
  ],
}

describe('getKnowledgeBaseStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('maps the backend snake_case payload to the UI camelCase shape', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(backendPayload), { status: 200 }))

    const status = await getKnowledgeBaseStatus()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v1/oib/status')
    expect(status.collectionName).toBe('oib_knowledge')
    expect(status.collectionExists).toBe(true)
    expect(status.summary).toEqual({
      totalFiles: 2,
      ingested: 1,
      stale: 0,
      pending: 1,
      failed: 0,
      removed: 0,
      inconsistent: 0,
      totalChunks: 42,
    })
    expect(status.files[0]).toEqual({
      fileName: 'oib-rl_1_ausgabe_mai_2023.pdf',
      state: 'ingested',
      sizeBytes: 1234,
      chunkCount: 42,
      ingestedSha256: 'abc',
      currentSha256: 'abc',
      countryId: 'AT',
      ingestedAt: '2026-06-30T12:00:00Z',
      summary: 'Brandschutz.',
      docClass: null,
      docClassSuggestion: 'oib_guideline',
      displayTitle: 'OIB-Richtlinie 1, Ausgabe Mai 2023',
    })
    expect(status.files[1].state).toBe('pending')
    expect(status.files[1].sizeBytes).toBe(99)
  })

  it('tolerates missing/malformed fields with safe defaults', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({ files: [{ state: 'bogus', chunk_count: -3 }] }),
        { status: 200 },
      ),
    )

    const status = await getKnowledgeBaseStatus()

    expect(status.collectionName).toBe('')
    expect(status.collectionExists).toBe(false)
    expect(status.summary.totalFiles).toBe(0)
    expect(status.files[0]).toMatchObject({ fileName: 'unknown', state: 'pending', chunkCount: 0 })
  })

  it('throws UpstreamError on a non-OK backend response', async () => {
    fetchMock.mockResolvedValue(new Response('boom', { status: 503 }))

    await expect(getKnowledgeBaseStatus()).rejects.toBeInstanceOf(UpstreamError)
  })

  it('throws UpstreamError when the backend is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(getKnowledgeBaseStatus()).rejects.toBeInstanceOf(UpstreamError)
  })

  it('throws UpstreamError on malformed JSON', async () => {
    fetchMock.mockResolvedValue(new Response('not json', { status: 200 }))

    await expect(getKnowledgeBaseStatus()).rejects.toBeInstanceOf(UpstreamError)
  })

  it('maps the removed state of an indexed file the corpus no longer lists', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          collection_exists: true,
          summary: { removed: 1 },
          files: [{ file_name: 'a.pdf', state: 'removed', chunk_count: 5 }],
        }),
        { status: 200 },
      ),
    )

    const status = await getKnowledgeBaseStatus()

    expect(status.summary.removed).toBe(1)
    expect(status.files[0]).toMatchObject({ state: 'removed', chunkCount: 5 })
    expect(status.files[0]).not.toHaveProperty('origin')
  })

  it('maps the failed state of a file whose ingest job did not finish', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          collection_exists: true,
          summary: { failed: 1 },
          files: [{ file_name: 'a.pdf', state: 'failed', chunk_count: 0 }],
        }),
        { status: 200 },
      ),
    )

    const status = await getKnowledgeBaseStatus()

    expect(status.summary.failed).toBe(1)
    expect(status.files[0]).toMatchObject({ state: 'failed' })
  })

  it('reads a state it does not know as pending', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ files: [{ file_name: 'a.pdf', state: 'snapshot' }] }), { status: 200 }),
    )

    expect((await getKnowledgeBaseStatus()).files[0].state).toBe('pending')
  })
})

describe('knowledge admin operations', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('uploads a PDF with the admin token header', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', file_name: 'norm.pdf', message: 'ok' }), { status: 200 }),
    )

    const result = await uploadKnowledgeBaseDocument(new File([new Uint8Array([1])], 'norm.pdf'))

    expect(result).toMatchObject({ status: 'success', fileName: 'norm.pdf', message: 'ok' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/v1/admin/oib/documents')
    expect((init?.headers as Record<string, string>)['X-Admin-Token']).toBe('admin-secret')
  })

  it('answers the api tier’s refusal to put other bytes under a name it keeps as a conflict, not as a broken backend', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail: 'the base corpus keeps other bytes as norm.pdf' }), { status: 409 }))

    await expect(uploadKnowledgeBaseDocument(new File([new Uint8Array([1])], 'norm.pdf'))).rejects.toMatchObject({ status: 409, code: 'NAME_TAKEN' })
  })

  it('rejects non-PDF or path-carrying filenames before calling the backend', async () => {
    await expect(uploadKnowledgeBaseDocument(new File([new Uint8Array([1])], 'evil.exe'))).rejects.toBeInstanceOf(
      BadRequestError,
    )
    await expect(deleteKnowledgeBaseDocument('../secret.pdf')).rejects.toBeInstanceOf(BadRequestError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a 404 delete to NotFoundError', async () => {
    fetchMock.mockResolvedValue(new Response('nope', { status: 404 }))

    await expect(deleteKnowledgeBaseDocument('missing.pdf')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('returns sync counts', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ files_added: 3, files_total: 42, message: 'ok' }), { status: 200 }),
    )

    await expect(syncKnowledgeBase()).resolves.toEqual({ filesAdded: 3, filesTotal: 42, message: 'ok' })
  })
})

describe('getReleasedKnowledgeBaseStatus', () => {
  // One file per class the corpus holds. The countries are invented: the rule
  // compares a file's mark with the reader's countries and knows no country.
  const file = (file_name: string, country_id: string | null, state = 'ingested', chunk_count = 5) => ({ file_name, country_id, state, chunk_count })
  const corpus = {
    collection_name: 'base',
    collection_exists: true,
    summary: { total_files: 5, ingested: 4, pending: 1, total_chunks: 25 },
    files: [
      file('released-here.pdf', 'QA'),
      file('released-here-pending.pdf', 'QA', 'pending', 0),
      file('released-elsewhere.pdf', 'QB'),
      file('rolled-back.pdf', 'ZZ'),
      file('draft-upload.pdf', null),
    ],
  }

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(corpus), { status: 200 }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the files released in the reader’s countries, and no draft, rolled-back or other country’s file', async () => {
    const status = await getReleasedKnowledgeBaseStatus(['QA'])

    expect(status.files.map((entry) => entry.fileName)).toEqual(['released-here.pdf', 'released-here-pending.pdf'])
  })

  it('counts over the listed files alone, so a count cannot tell what else the corpus holds', async () => {
    const status = await getReleasedKnowledgeBaseStatus(['QA'])

    expect(status.summary).toEqual({ totalFiles: 2, ingested: 1, stale: 0, pending: 1, failed: 0, removed: 0, inconsistent: 0, totalChunks: 5 })
  })

  it('lists a second country’s files for a reader of both', async () => {
    const status = await getReleasedKnowledgeBaseStatus(['QA', 'QB'])

    expect(status.files.map((entry) => entry.fileName)).toContain('released-elsewhere.pdf')
  })

  it('lists nothing for a reader of no country', async () => {
    const status = await getReleasedKnowledgeBaseStatus([])

    expect(status.files).toEqual([])
    expect(status.summary.totalFiles).toBe(0)
    expect(status.summary.totalChunks).toBe(0)
  })

  it('keeps the whole corpus for the platform’s own reader', async () => {
    expect((await getKnowledgeBaseStatus()).files).toHaveLength(5)
  })
})

describe('withdrawCorpusFile', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    process.env.INTERNAL_API_TOKEN = 'test-token'
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.INTERNAL_API_TOKEN
  })

  it('marks the file unreleased and keeps its country', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ released: false, chunks: 3 }), { status: 200 }))

    await withdrawCorpusFile('rolled-back.pdf')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/knowledge-mark')
    expect(JSON.parse(String(init.body))).toEqual({ file_name: 'rolled-back.pdf', released: false })
  })

  it('throws, so the job retries, when the backend does not echo the withdrawal', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ chunks: 3 }), { status: 200 }))

    await expect(withdrawCorpusFile('rolled-back.pdf')).rejects.toBeInstanceOf(UpstreamError)
  })

  it('takes a file with no chunks as withdrawn once its row is, and a 404 as a backend that wrote nothing', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ released: false, chunks: 0 }), { status: 200 }))
    await expect(withdrawCorpusFile('rolled-back.pdf')).resolves.toBeUndefined()

    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 404 }))
    await expect(withdrawCorpusFile('rolled-back.pdf')).rejects.toBeInstanceOf(UpstreamError)
  })
})

describe('reingestKnowledgeBaseDocuments with release marks', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    vi.stubEnv('ADMIN_TOKEN', 'admin-secret')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })
  const marks = { 'a.pdf': { countryId: 'XA', editionId: 'edition:one' } }

  it('accepts an answer that recorded every marked file as released', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'pending', queued: ['a.pdf'], released: ['a.pdf'] }), { status: 200 }))

    await expect(reingestKnowledgeBaseDocuments(['a.pdf'], marks)).resolves.toMatchObject({ queued: ['a.pdf'] })
  })

  it("carries the backend's own reason, so an index run says why the corpus refused it", async () => {
    const detail = 'could not hand ingestion job oib-1 to Hatchet: WorkflowNotRegistered'
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ detail }), { status: 500 }))

    await expect(reingestKnowledgeBaseDocuments(['a.pdf'], marks)).rejects.toThrow(`Knowledge backend returned 500: ${detail}`)
  })

  it('keeps a bare status when the backend says nothing', async () => {
    fetchMock.mockResolvedValue(new Response('', { status: 500 }))

    await expect(reingestKnowledgeBaseDocuments(['a.pdf'], marks)).rejects.toThrow(/^Knowledge backend returned 500$/)
  })

  it('throws, so the indexing job retries, when a backend from before the flag leaves the file unreleased', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ status: 'pending', queued: ['a.pdf'] }), { status: 200 }))

    await expect(reingestKnowledgeBaseDocuments(['a.pdf'], marks)).rejects.toBeInstanceOf(UpstreamError)
  })
})
