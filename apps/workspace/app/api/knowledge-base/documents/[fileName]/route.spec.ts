/**
 * @vitest-environment node
 *
 * The source PDF route, per class of file the base corpus holds (ADR-0173). The
 * backend here is a stand-in that keeps each file's release mark and applies the
 * rule the real one applies (`corpus_store.released_to`, held by
 * `apps/agent-host/tests/test_oib_documents_routes.py`); what this spec holds is
 * that the route asks as the session's office and as nobody else, and that every
 * refusal looks the same from outside. The countries are invented.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const requireAuthorizedSessionMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: requireAuthorizedSessionMock }))

const corpusCountriesForMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/base-knowledge/context/corpus-countries', () => ({ corpusCountriesFor: corpusCountriesForMock }))

vi.mock('@/lib/backend-url', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('@/lib/internal-auth', () => ({ internalServiceHeaders: () => ({ 'x-test-internal-token': 'internal' }) }))

import { GET } from './route'

/** Each file the corpus holds and the mark its release wrote; null is a text no release marked. */
const MARKS: Record<string, string | null> = {
  'released-here.pdf': 'QA',
  'released-elsewhere.pdf': 'QB',
  'rolled-back.pdf': 'ZZ',
  'draft-upload.pdf': null,
}
const WITHHELD = ['released-elsewhere.pdf', 'rolled-back.pdf', 'draft-upload.pdf']

const fetchMock = vi.fn()

/** The backend's office read: the file when its mark is one of the countries asked as, else its 404. */
async function backend(input: string): Promise<Response> {
  const url = new URL(input)
  const name = decodeURIComponent(url.pathname.split('/').pop() ?? '')
  const mark = MARKS[name]
  if (!url.pathname.startsWith('/v1/corpus/documents/') || !mark || !url.searchParams.getAll('country').includes(mark)) {
    return new Response(JSON.stringify({ detail: 'Source PDF not available' }), { status: 404 })
  }
  return new Response(new Blob([`%PDF ${name}`]), { status: 200 })
}

function read(fileName: string): Promise<Response> {
  const request = new Request(`https://grid.example/api/knowledge-base/documents/${encodeURIComponent(fileName)}`)
  return GET(request, { params: Promise.resolve({ fileName }) })
}

async function withoutRequestId(res: Response): Promise<unknown> {
  const { requestId: _requestId, ...rest } = (await res.json()) as Record<string, unknown>
  return rest
}

function signedInTo(organizationId: string): void {
  requireAuthorizedSessionMock.mockResolvedValue({ userId: 'user_1', organizationId, role: 'member', permissions: [] })
}

describe('GET /api/knowledge-base/documents/[fileName]', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    fetchMock.mockImplementation(backend)
    requireAuthorizedSessionMock.mockReset()
    signedInTo('org_qa')
    corpusCountriesForMock.mockReset()
    corpusCountriesForMock.mockImplementation(async (organizationId: string) => (organizationId === 'org_qa' ? ['QA'] : []))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serves a file released in a country the office is entitled to', async () => {
    const res = await read('released-here.pdf')

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('%PDF released-here.pdf')
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('asks the backend as the session’s own office: its entitled countries and no others', async () => {
    await read('released-here.pdf')

    expect(corpusCountriesForMock).toHaveBeenCalledWith('org_qa')
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.getAll('country')).toEqual(['QA'])
  })

  it.each(WITHHELD)('answers %s, which the office may not read, exactly as a name that does not exist', async (fileName) => {
    const missing = await read('no-such-file.pdf')
    const res = await read(fileName)

    expect(missing.status).toBe(404)
    expect(res.status).toBe(404)
    // Only the request id differs: nothing in the answer says which of the two it was.
    expect(await withoutRequestId(res)).toEqual(await withoutRequestId(missing))
    expect(res.headers.get('Content-Type')).toBe(missing.headers.get('Content-Type'))
  })

  it('serves another country’s file once the office is entitled to that country', async () => {
    corpusCountriesForMock.mockResolvedValue(['QA', 'QB'])

    expect((await read('released-elsewhere.pdf')).status).toBe(200)
  })

  it.each(Object.keys(MARKS))('answers 404 for %s to an office entitled to no country, without asking the backend', async (fileName) => {
    signedInTo('org_without_countries')

    const res = await read(fileName)

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a name with a path in it before anything is asked', async () => {
    const res = await read('../released-here.pdf')

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
