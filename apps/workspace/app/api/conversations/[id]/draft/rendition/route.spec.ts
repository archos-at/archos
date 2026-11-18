/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'member',
    permissions: [],
  }),
}))

const requireResourceAccessMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/sharing/access', () => ({
  requireResourceAccess: requireResourceAccessMock,
}))

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

const convertOfficeToPdf = vi.hoisted(() => vi.fn())
vi.mock('@/lib/documents/rendition', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/rendition')>()),
  convertOfficeToPdf,
}))

import { RenditionUnavailableError } from '@/lib/documents/rendition'
import { forgetDraftRenditions } from '@/lib/conversations/draft-rendition'
import { GET } from './route'

const fetchMock = vi.fn()

const PDF = new TextEncoder().encode('%PDF-1.7\n')
const DOCX = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x01])

const rawAnswer = (bytes: Uint8Array) => new Response(Buffer.from(bytes), { status: 200 })

const get = (path: string, headers: Record<string, string> = {}) =>
  GET(
    new Request(`https://grid.example/api/conversations/conv-1/draft/rendition?path=${encodeURIComponent(path)}`, {
      headers,
    }),
    { params: Promise.resolve({ id: 'conv-1' }) },
  )

describe('GET /api/conversations/[id]/draft/rendition', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forgetDraftRenditions()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    vi.stubGlobal('fetch', fetchMock)
    requireResourceAccessMock.mockResolvedValue({ role: 'viewer' })
    fetchMock.mockImplementation(async () => rawAnswer(DOCX))
    convertOfficeToPdf.mockResolvedValue(PDF)
  })

  it('converts a Word draft to a PDF once, and answers the second read from its cache', async () => {
    const first = await get('/drafts/vermerk.docx')
    const second = await get('/drafts/vermerk.docx')

    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('application/pdf')
    expect(first.headers.get('content-disposition')).toMatch(/^inline; filename="vermerk\.pdf"/)
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PDF)
    expect(second.status).toBe(200)
    expect(convertOfficeToPdf).toHaveBeenCalledTimes(1)
    const [, filename, timeout] = convertOfficeToPdf.mock.calls[0]
    expect(filename).toBe('vermerk.docx')
    expect(timeout).toBeLessThanOrEqual(60_000)
  })

  it('answers 304 when the browser already holds these bytes', async () => {
    const first = await get('/drafts/vermerk.docx')
    const etag = first.headers.get('etag') ?? ''

    const again = await get('/drafts/vermerk.docx', { 'If-None-Match': etag })

    expect(again.status).toBe(304)
    expect(convertOfficeToPdf).toHaveBeenCalledTimes(1)
  })

  it('serves a PDF draft as it is, without the converter', async () => {
    fetchMock.mockImplementation(async () => rawAnswer(PDF))

    const res = await get('/drafts/bericht.pdf')

    expect(res.status).toBe(200)
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF)
    expect(convertOfficeToPdf).not.toHaveBeenCalled()
  })

  it('refuses a draft that has no PDF form', async () => {
    const res = await get('/drafts/tabelle.csv')

    expect(res.status).toBe(422)
    expect(convertOfficeToPdf).not.toHaveBeenCalled()
  })

  it('says 503 when no converter is configured', async () => {
    convertOfficeToPdf.mockRejectedValue(new RenditionUnavailableError('not configured'))

    const res = await get('/drafts/vermerk.docx')

    expect(res.status).toBe(503)
  })

  it('keeps one office’s rendition from another office', async () => {
    await get('/drafts/vermerk.docx')
    const { requireAuthorizedSession } = await import('@/lib/auth/require-auth')
    vi.mocked(requireAuthorizedSession).mockResolvedValueOnce({
      userId: 'user_2',
      organizationId: 'org_2',
      role: 'member',
      permissions: [],
    } as never)

    await get('/drafts/vermerk.docx')

    expect(convertOfficeToPdf).toHaveBeenCalledTimes(2)
  })
})
