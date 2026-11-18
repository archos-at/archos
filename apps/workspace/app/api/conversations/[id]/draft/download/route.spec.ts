/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NotFoundError } from '@/lib/api/errors'

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

import { GET } from './route'

const fetchMock = vi.fn()

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const rawAnswer = (bytes: Uint8Array) =>
  new Response(Buffer.from(bytes), { status: 200, headers: { 'Content-Type': 'application/octet-stream' } })

const get = (query: string) =>
  GET(new Request(`https://grid.example/api/conversations/conv-1/draft/download${query}`), {
    params: Promise.resolve({ id: 'conv-1' }),
  })

describe('GET /api/conversations/[id]/draft/download', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    vi.stubGlobal('fetch', fetchMock)
    requireResourceAccessMock.mockResolvedValue({ role: 'viewer' })
    fetchMock.mockResolvedValue(rawAnswer(new Uint8Array([0x50, 0x4b, 0x03, 0x04])))
  })

  it('streams the raw bytes with the type of the file and a download name', async () => {
    const res = await get('?path=%2Fdrafts%2FFl%C3%A4chenaufstellung.xlsx')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe(XLSX)
    expect(res.headers.get('content-disposition')).toBe(
      `attachment; filename="Fl_chenaufstellung.xlsx"; filename*=UTF-8''Fl%C3%A4chenaufstellung.xlsx`,
    )
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://backend:8000/v1/drafts/conv-1/drafts/Fl%C3%A4chenaufstellung.xlsx?raw=true')
    expect(init.headers['x-internal-token']).toBe('test-token')
    expect(requireResourceAccessMock).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: 'org_1' }),
      'conversation',
      'conv-1',
      'viewer',
    )
  })

  it('sandboxes an SVG so a script in it never runs on this origin', async () => {
    fetchMock.mockResolvedValue(rawAnswer(new TextEncoder().encode('<svg><script>alert(1)</script></svg>')))

    const res = await get('?path=%2Fdrafts%2Fschnitt.svg')

    expect(res.headers.get('content-type')).toBe('image/svg+xml')
    expect(res.headers.get('content-security-policy')).toContain('sandbox')
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('never answers HTML as HTML', async () => {
    fetchMock.mockResolvedValue(rawAnswer(new TextEncoder().encode('<script>alert(1)</script>')))

    const res = await get('?path=%2Fdrafts%2Fseite.html')

    expect(res.headers.get('content-type')).toBe('text/plain')
  })

  it.each([
    ['seite.html', '<script>alert(1)</script>'],
    ['seite.htm', '<script>alert(1)</script>'],
    ['seite.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></html>'],
    ['seite.HTML', '<script>alert(1)</script>'],
    ['schnitt.svg', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ['schnitt.SVG', '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'],
    ['daten.xml', '<?xml-stylesheet href="x.xsl"?><a/>'],
    ['skript.js', 'alert(1)'],
    ['ohne-endung', '<script>alert(1)</script>'],
  ])('serves an unchecked run file %s only as a sandboxed attachment', async (name, body) => {
    fetchMock.mockResolvedValue(rawAnswer(new TextEncoder().encode(body)))

    const res = await get(`?path=${encodeURIComponent(`/drafts/${name}`)}`)

    expect(res.status).toBe(200)
    const type = res.headers.get('content-type') ?? ''
    if (name.toLowerCase().endsWith('.svg')) expect(type).toBe('image/svg+xml')
    else expect(type).not.toMatch(/html|xml|javascript/)
    expect(res.headers.get('content-disposition')).toMatch(/^attachment;/)
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    const policy = res.headers.get('content-security-policy') ?? ''
    expect(policy).toContain("default-src 'none'")
    expect(policy).toContain('sandbox')
    expect(policy).not.toMatch(/script-src/)
  })

  it('answers 404 without addressing the backend when the reader may not see the conversation', async () => {
    requireResourceAccessMock.mockRejectedValue(new NotFoundError())

    const res = await get('?path=%2Fdrafts%2Fa.xlsx')

    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses a file over the size cap', async () => {
    fetchMock.mockResolvedValue(
      new Response('x', { status: 200, headers: { 'Content-Length': String(30_000_000) } }),
    )

    const res = await get('?path=%2Fdrafts%2Fa.pdf')

    expect(res.status).toBe(413)
  })

  it('rejects a missing path with 400 before the resource gate', async () => {
    const res = await get('')

    expect(res.status).toBe(400)
    expect(requireResourceAccessMock).not.toHaveBeenCalled()
  })
})
