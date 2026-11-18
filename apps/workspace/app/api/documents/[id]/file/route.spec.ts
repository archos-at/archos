/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextRequest } from 'next/server'

vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user-1',
    organizationId: 'org-1',
    email: 'test@grid.com',
    role: 'admin',
  }),
}))

vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn().mockResolvedValue({ role: 'project-admin' }),
}))

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

const send = vi.hoisted(() => vi.fn())

vi.mock('@/lib/s3', () => ({
  s3Client: { send },
  signingS3Client: {},
  bucketName: 'grid-documents',
}))

vi.mock('@/lib/documents/rendition', async (importOriginal) => {
  const { renditionModuleMock } = await import('@/test-utils/rendition-module')
  return renditionModuleMock(await importOriginal(), true)
})

import { GET } from './route'
import { getDb } from '@/lib/db'
import { RenditionFailedError, ensureRendition, isRenditionEnabled } from '@/lib/documents/rendition'
import type { getDb as getDbType } from '@/lib/db'

const asDb = (stub: Record<string, unknown>): ReturnType<typeof getDbType> =>
  stub as unknown as ReturnType<typeof getDbType>

const withRow = (row: Record<string, unknown> | null): void => {
  vi.mocked(getDb).mockReturnValue(
    asDb({
      select: vi.fn().mockReturnThis(),
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(row ? [row] : []),
    })
  )
}

const PDF_ROW = {
  storageKey: 'org/org-1/project/proj-1/doc/doc-1/plan.pdf',
  contentType: 'application/pdf',
  filename: 'Einreichplan Ostfassade.pdf',
  organizationId: 'org-1',
  projectId: 'proj-1',
  scope: 'project',
}

const call = (): Promise<Response> =>
  GET(new Request('https://grid.test/api/documents/doc-1/file') as unknown as NextRequest, {
    params: Promise.resolve({ id: 'doc-1' }),
  })

beforeEach(() => {
  send.mockReset()
  vi.mocked(isRenditionEnabled).mockReturnValue(true)
  vi.mocked(ensureRendition).mockReset()
})

describe('GET /api/documents/[id]/file', () => {
  it('streams the stored bytes inline from this origin', async () => {
    withRow(PDF_ROW)
    send.mockResolvedValue({
      Body: { transformToWebStream: () => new ReadableStream() },
    })

    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe(
      'inline; filename="Einreichplan Ostfassade.pdf"'
    )
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300')
  })

  it('allows same-origin framing so the viewer fallback can render it', async () => {
    withRow(PDF_ROW)
    send.mockResolvedValue({ Body: { transformToWebStream: () => new ReadableStream() } })

    const response = await call()
    expect(response.headers.get('X-Frame-Options')).toBe('SAMEORIGIN')
    expect(response.headers.get('Content-Security-Policy')).toBe("frame-ancestors 'self'")
  })

  it('is 404 for a document the session cannot reach', async () => {
    withRow(null)
    expect((await call()).status).toBe(404)
  })

  it('is 404 when the row carries no stored object', async () => {
    withRow({ ...PDF_ROW, storageKey: null })
    expect((await call()).status).toBe(404)
    expect(send).not.toHaveBeenCalled()
  })

  it('is 404 when the object is gone from the store', async () => {
    withRow(PDF_ROW)
    send.mockRejectedValue(new Error('NoSuchKey'))
    expect((await call()).status).toBe(404)
  })

  it('refuses a content type that is not a PDF', async () => {
    withRow({ ...PDF_ROW, contentType: 'application/zip', filename: 'archive.zip' })
    expect((await call()).status).toBe(415)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses an SVG, which would otherwise run script in this origin', async () => {
    withRow({ ...PDF_ROW, contentType: 'image/svg+xml', filename: 'logo.svg' })
    expect((await call()).status).toBe(415)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a raster image — nothing needs to fetch image bytes same-origin', async () => {
    withRow({ ...PDF_ROW, contentType: 'image/png', filename: 'foto.png' })
    expect((await call()).status).toBe(415)
  })

  it('strips non-ASCII and quotes from the filename header', async () => {
    withRow({ ...PDF_ROW, filename: 'Gebäude"plan.pdf' })
    send.mockResolvedValue({ Body: { transformToWebStream: () => new ReadableStream() } })

    const response = await call()
    expect(response.headers.get('Content-Disposition')).toBe('inline; filename="Geb_ude_plan.pdf"')
  })

  describe('an office document', () => {
    const DOCX_ROW = {
      ...PDF_ROW,
      storageKey: 'org/org-1/project/proj-1/doc/doc-1/v1/Baubeschreibung.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename: 'Baubeschreibung.docx',
    }
    const RENDITION_KEY = 'org/org-1/project/proj-1/doc/doc-1/v1/_render.pdf'

    it('streams the rendition as a PDF', async () => {
      withRow(DOCX_ROW)
      vi.mocked(ensureRendition).mockResolvedValue(RENDITION_KEY)
      send.mockResolvedValue({ Body: { transformToWebStream: () => new ReadableStream() } })

      const response = await call()
      expect(response.status).toBe(200)
      expect(response.headers.get('Content-Type')).toBe('application/pdf')
      expect(response.headers.get('Content-Disposition')).toBe('inline; filename="Baubeschreibung.pdf"')
      expect(send.mock.calls[0][0].input.Key).toBe(RENDITION_KEY)
    })

    it('is 415 when conversion is not configured, and reads nothing', async () => {
      vi.mocked(isRenditionEnabled).mockReturnValue(false)
      withRow(DOCX_ROW)

      expect((await call()).status).toBe(415)
      expect(ensureRendition).not.toHaveBeenCalled()
      expect(send).not.toHaveBeenCalled()
    })

    it('is 502 RENDITION_FAILED when the converter fails', async () => {
      withRow(DOCX_ROW)
      vi.mocked(ensureRendition).mockRejectedValue(new RenditionFailedError('timeout'))

      const response = await call()
      expect(response.status).toBe(502)
      expect((await response.json()).code).toBe('RENDITION_FAILED')
      expect(send).not.toHaveBeenCalled()
    })
  })
})
