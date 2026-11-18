/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDocument } from '@/test-utils/db-fixtures'
import { archiveDocument } from './version-content'
import { agentDocument, document, session } from './version-content.fixtures'
import { getAccessibleDocument } from './access'
import { purgeIngestedChunks } from './collection-file-ref'
import { cancelDocumentIngest } from './reingest'
import { markDocumentNotIndexed } from './repository'
import { setDocumentLifecycle } from './version-repository'
import { recordAuditEvent } from '@/lib/audit/service'
import { maySeeHeld } from '@/lib/upload-screening/quarantine-reviewers'

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

describe('archiveDocument', () => {
  it('leaves the listings without deleting anything, and audits', async () => {
    const result = await archiveDocument(session, 'doc_1')
    expect(result).toEqual({ documentId: 'doc_1', lifecycle: 'archived' })
    expect(setDocumentLifecycle).toHaveBeenCalledWith('doc_1', 'org_1', 'archived')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.archived', targetId: 'doc_1' }),
    )
  })

  it('takes the passages with it, so an archived document stops answering', async () => {
    await archiveDocument(session, 'doc_1')

    expect(purgeIngestedChunks).toHaveBeenCalledWith(
      'http://backend:8000',
      expect.objectContaining({ filename: 'plan.pdf' }),
      expect.any(Number),
    )
    expect(vi.mocked(purgeIngestedChunks).mock.calls[0]).toHaveLength(3)
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ chunksPurged: true }) }),
    )
  })

  it('stops saying the document was read, so it no longer shows as citable', async () => {
    await archiveDocument(session, 'doc_1')
    expect(markDocumentNotIndexed).toHaveBeenCalledWith('doc_1', 'org_1')
  })

  it('purges nothing for an agent draft, which owns no passages to purge', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(
      makeDocument({ ...agentDocument, publishedVersionId: null }),
    )

    await archiveDocument(session, 'doc_1')

    expect(purgeIngestedChunks).not.toHaveBeenCalled()
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ chunksPurged: null }) }),
    )
  })

  describe('a document that is still being read', () => {
    const reading = makeDocument({ id: 'doc_1', projectId: 'proj_1', status: 'pending' })

    beforeEach(() => {
      vi.mocked(getAccessibleDocument).mockResolvedValue(reading)
      vi.mocked(purgeIngestedChunks).mockResolvedValue(true)
    })

    it('stops the read before it archives and purges, so the job writes no chunks afterwards', async () => {
      vi.mocked(cancelDocumentIngest).mockResolvedValue({ id: 'doc_1', result: 'cancelled', status: 'cancelled' })

      await archiveDocument(session, 'doc_1')

      expect(cancelDocumentIngest).toHaveBeenCalledWith(session, 'doc_1')
      const stopped = vi.mocked(cancelDocumentIngest).mock.invocationCallOrder[0]
      expect(stopped).toBeLessThan(vi.mocked(setDocumentLifecycle).mock.invocationCallOrder[0])
      expect(stopped).toBeLessThan(vi.mocked(purgeIngestedChunks).mock.invocationCallOrder[0])
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ readStopped: 'cancelled' }) }),
      )
    })

    it('ends not indexed, not cancelled: the stop settles the row and the archive then says what the person asked for', async () => {
      vi.mocked(cancelDocumentIngest).mockResolvedValue({ id: 'doc_1', result: 'cancelled', status: 'cancelled' })

      await archiveDocument(session, 'doc_1')

      expect(vi.mocked(cancelDocumentIngest).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(markDocumentNotIndexed).mock.invocationCallOrder[0],
      )
    })

    it('archives all the same when the queue cannot be reached, and says so on the trail', async () => {
      vi.mocked(cancelDocumentIngest).mockRejectedValue(new Error('backend down'))
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      const result = await archiveDocument(session, 'doc_1')

      expect(result.lifecycle).toBe('archived')
      expect(setDocumentLifecycle).toHaveBeenCalledWith('doc_1', 'org_1', 'archived')
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ readStopped: 'unreachable' }) }),
      )
      warn.mockRestore()
    })
  })

  it('asks for no stop on a document that has come to rest', async () => {
    await archiveDocument(session, 'doc_1')
    expect(cancelDocumentIngest).not.toHaveBeenCalled()
  })

  it('archives even when the backend refuses, and says so on the trail', async () => {
    vi.mocked(purgeIngestedChunks).mockResolvedValue(false)

    const result = await archiveDocument(session, 'doc_1')

    expect(result.lifecycle).toBe('archived')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ chunksPurged: false }) }),
    )
  })
})
