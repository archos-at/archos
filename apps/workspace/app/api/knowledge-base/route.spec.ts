/**
 * @vitest-environment node
 *
 * The office's corpus listing, per class of file the base corpus holds
 * (ADR-0173). The countries are invented: the rule reads marks and entitlements.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireAuthorizedSessionMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: requireAuthorizedSessionMock,
}))

const corpusCountriesForMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/base-knowledge/context/corpus-countries', () => ({ corpusCountriesFor: corpusCountriesForMock }))

vi.mock('@/lib/backend-url', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/internal-auth', () => ({ internalServiceHeaders: () => ({}) }))

import { GET } from './route'

const file = (file_name: string, country_id: string | null) => ({ file_name, country_id, state: 'ingested', chunk_count: 3, summary: `what ${file_name} says` })
const CORPUS = {
  collection_name: 'base',
  collection_exists: true,
  summary: { total_files: 4, ingested: 4, total_chunks: 12 },
  files: [file('released-here.pdf', 'QA'), file('released-elsewhere.pdf', 'QB'), file('rolled-back.pdf', 'ZZ'), file('draft-upload.pdf', null)],
}

const fetchMock = vi.fn()

function signedInTo(organizationId: string): void {
  requireAuthorizedSessionMock.mockResolvedValue({ userId: 'user_1', organizationId, role: 'member', permissions: [] })
}

async function listed(): Promise<{ status: number; names: string[]; text: string; totalFiles: number; totalChunks: number }> {
  const res = await GET(new Request('https://grid.example/api/knowledge-base'))
  const text = await res.text()
  const body = JSON.parse(text) as { files?: { fileName: string }[]; summary?: { totalFiles: number; totalChunks: number } }
  return {
    status: res.status,
    names: (body.files ?? []).map((entry) => entry.fileName),
    text,
    totalFiles: body.summary?.totalFiles ?? -1,
    totalChunks: body.summary?.totalChunks ?? -1,
  }
}

describe('GET /api/knowledge-base', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(CORPUS), { status: 200 }))
    requireAuthorizedSessionMock.mockReset()
    signedInTo('org_qa')
    corpusCountriesForMock.mockReset()
    corpusCountriesForMock.mockImplementation(async (organizationId: string) => (organizationId === 'org_qa' ? ['QA'] : []))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('lists the files released in a country the office is entitled to', async () => {
    const { status, names } = await listed()

    expect(status).toBe(200)
    expect(names).toEqual(['released-here.pdf'])
    expect(corpusCountriesForMock).toHaveBeenCalledWith('org_qa')
  })

  it.each(['released-elsewhere.pdf', 'rolled-back.pdf', 'draft-upload.pdf'])(
    'says nothing of %s: not its name, not its summary, not in a count',
    async (fileName) => {
      const { text, totalFiles, totalChunks } = await listed()

      expect(text).not.toContain(fileName)
      expect(totalFiles).toBe(1)
      expect(totalChunks).toBe(3)
    },
  )

  it('lists nothing for an office entitled to no country', async () => {
    signedInTo('org_without_countries')

    const { status, names, totalFiles } = await listed()

    expect(status).toBe(200)
    expect(names).toEqual([])
    expect(totalFiles).toBe(0)
  })

  it('maps upstream failures to the typed error envelope', async () => {
    fetchMock.mockImplementation(async () => {
      throw new Error('connection refused')
    })

    const res = await GET(new Request('https://grid.example/api/knowledge-base'))

    expect(res.status).toBe(502)
    expect(await res.json()).toMatchObject({ code: 'UPSTREAM_ERROR' })
  })
})
