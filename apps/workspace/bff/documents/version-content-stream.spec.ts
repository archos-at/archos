/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDocument } from '@/test-utils/db-fixtures'
import type { Document } from '@/lib/db/schema/documents'
import { NotFoundError } from '@/lib/api/errors'
import { s3Client } from '@/lib/s3'
import { recordDocumentAccess } from '@/lib/download-log/service'
import { getAccessibleDocument } from './access'
import { findDocumentVersion } from './version-repository'
import { maySeeHeld } from '@/lib/upload-screening/quarantine-reviewers'
import { streamVersionFile } from './version-content'
import { document, session, version } from './version-content.fixtures'

vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('./reingest', () => ({ cancelDocumentIngest: vi.fn() }))
vi.mock('./repository', () => ({ findDocumentInOrg: vi.fn(), markDocumentNotIndexed: vi.fn() }))
vi.mock('./version-repository', () => ({
  findDocumentVersion: vi.fn(),
  findDocumentVersionInOrg: vi.fn(),
  setDocumentLifecycle: vi.fn(),
  swapVersionContent: vi.fn(),
}))
vi.mock('@/lib/storage/discard', () => ({ discardObject: vi.fn() }))
vi.mock('@/lib/conversations/repository', () => ({ findConversationInOrg: vi.fn() }))
vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('@/lib/conversations/restricted-use', () => ({ admitRestrictedUse: vi.fn() }))
vi.mock('@/lib/projects/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/projects/repository')>()),
  findProjectCollectionName: vi.fn(async () => 'proj_abc'),
}))
vi.mock('@/lib/organizations/service', () => ({
  getOrganizationDisplayName: vi.fn().mockResolvedValue('Büro Nord ZT GmbH'),
}))
vi.mock('@/lib/storage/service', () => ({
  assertWithinStorageQuota: vi.fn(),
  getStorageQuotaBytes: vi.fn().mockResolvedValue(10_000),
  STORAGE_QUOTA_EXCEEDED_MESSAGE: 'no storage space left',
}))
vi.mock('@/lib/storage/bucket', () => ({
  ensureTenantBucketChecked: vi.fn().mockResolvedValue('grid-org-1'),
  resolveDocumentBucket: () => 'grid-org-1',
}))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/download-log/service', () => ({ recordDocumentAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ maySeeHeld: vi.fn() }))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('./collection-file-ref', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./collection-file-ref')>()),
  purgeIngestedChunks: vi.fn().mockResolvedValue(true),
}))
vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn() },
  bucketAdminS3Client: { send: vi.fn() },
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessibleDocument).mockResolvedValue(document)
  vi.mocked(maySeeHeld).mockResolvedValue(false)
})

describe('streamVersionFile — an earlier upload under the same name, as bytes', () => {
  const pdfDocument: Document = makeDocument({ id: 'doc_1', projectId: 'proj_1', filename: 'Werkvertrag Ä.pdf', contentType: 'application/pdf' })
  const bytes = () => ({ transformToWebStream: () => new Response('%PDF-1.7 v1').body })

  beforeEach(() => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(pdfDocument)
    vi.mocked(findDocumentVersion).mockResolvedValue(
      version({ state: 'superseded', contentType: 'application/pdf', storageKey: 'org/o/doc/d/v1/a/Werkvertrag.pdf' }),
    )
    vi.mocked(s3Client.send).mockResolvedValue({ Body: bytes() } as never)
    vi.mocked(maySeeHeld).mockResolvedValue(true)
  })

  it('refuses a member the bytes of an earlier upload no verdict judged, reading no byte (ADR-0086)', async () => {
    vi.mocked(maySeeHeld).mockResolvedValue(false)

    await expect(streamVersionFile(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 404 })

    expect(maySeeHeld).toHaveBeenCalledWith(session, pdfDocument)
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(recordDocumentAccess).not.toHaveBeenCalled()
  })

  it('streams a member an earlier upload whose own verdict passed its bytes (migration 0131)', async () => {
    vi.mocked(maySeeHeld).mockResolvedValue(false)
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...pdfDocument, contentHash: 'sha256:now', screenedHash: 'sha256:now' })
    vi.mocked(findDocumentVersion).mockResolvedValue(
      version({ state: 'superseded', contentType: 'application/pdf', contentHash: 'sha256:abc', screenedHash: 'sha256:abc' }),
    )

    const response = await streamVersionFile(session, 'doc_1', 'ver_1')

    expect(await response.text()).toBe('%PDF-1.7 v1')
    expect(maySeeHeld).not.toHaveBeenCalled()
  })

  it('streams a member the version whose bytes the verdict judged', async () => {
    vi.mocked(maySeeHeld).mockResolvedValue(false)
    vi.mocked(getAccessibleDocument).mockResolvedValue({ ...pdfDocument, contentHash: 'sha256:abc', screenedHash: 'sha256:abc' })
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'published', contentType: 'application/pdf' }))

    const response = await streamVersionFile(session, 'doc_1', 'ver_1')

    expect(await response.text()).toBe('%PDF-1.7 v1')
  })

  it('streams the version’s own object, inline for a PDF, and records the hand-over', async () => {
    const response = await streamVersionFile(session, 'doc_1', 'ver_1')

    expect(await response.text()).toBe('%PDF-1.7 v1')
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toMatch(/^inline; filename="Werkvertrag _\.pdf"/)
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=300')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    const command = vi.mocked(s3Client.send).mock.calls[0]?.[0] as { input: { Bucket: string; Key: string } }
    expect(command.input).toEqual({ Bucket: 'grid-org-1', Key: 'org/o/doc/d/v1/a/Werkvertrag.pdf' })
    expect(recordDocumentAccess).toHaveBeenCalledWith(session, pdfDocument, 'version', { versionId: 'ver_1' })
  })

  it('is an attachment when asked to download, and never frames', async () => {
    const response = await streamVersionFile(session, 'doc_1', 'ver_1', { download: true })

    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; /)
    expect(response.headers.get('X-Frame-Options')).toBeNull()
  })

  it('never serves script-capable bytes inline: HTML and SVG leave as an octet-stream attachment', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'published', contentType: 'image/svg+xml' }))

    const response = await streamVersionFile(session, 'doc_1', 'ver_1')

    expect(response.headers.get('Content-Disposition')).toMatch(/^attachment; /)
    expect(response.headers.get('Content-Type')).toBe('application/octet-stream')
  })

  it('answers 404 for a version of another document, reading no byte', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(null)

    await expect(streamVersionFile(session, 'doc_2', 'ver_1')).rejects.toMatchObject({ status: 404 })

    expect(findDocumentVersion).toHaveBeenCalledWith('ver_1', 'doc_2', 'org_1')
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(recordDocumentAccess).not.toHaveBeenCalled()
  })

  it.each(['draft', 'in_review', 'changes_requested', 'approved', 'rejected'] as const)(
    'refuses a %s version: unreleased work is not part of the timeline',
    async (state) => {
      vi.mocked(findDocumentVersion).mockResolvedValue(version({ state }))

      await expect(streamVersionFile(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 404 })

      expect(s3Client.send).not.toHaveBeenCalled()
    },
  )

  it('refuses a held document before it looks at a version (ADR-0086)', async () => {
    vi.mocked(getAccessibleDocument).mockRejectedValue(new NotFoundError())

    await expect(streamVersionFile(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 404 })

    expect(findDocumentVersion).not.toHaveBeenCalled()
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('answers 404 when the object is gone from the store', async () => {
    vi.mocked(s3Client.send).mockRejectedValue(new Error('NoSuchKey'))

    await expect(streamVersionFile(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 404 })
    expect(recordDocumentAccess).not.toHaveBeenCalled()
  })

  it('does not hand the bytes over when the log refuses (a folder with its own list)', async () => {
    vi.mocked(recordDocumentAccess).mockRejectedValueOnce(Object.assign(new Error('not recorded'), { status: 503 }))

    await expect(streamVersionFile(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 503 })
  })
})
