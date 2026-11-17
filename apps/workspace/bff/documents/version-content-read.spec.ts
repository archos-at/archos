/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeDocument } from '@/test-utils/db-fixtures'
import { findConversationInOrg } from '@/lib/conversations/repository'
import { placementCollectionFor } from '@/lib/authz/folder-access'
import { admitRestrictedUse } from '@/lib/conversations/restricted-use'
import { s3Client } from '@/lib/s3'
import { recordDocumentAccess } from '@/lib/download-log/service'
import { mayReadDocument } from './document-reader'
import { getAccessibleDocument } from './access'
import { findDocumentInOrg } from './repository'
import { findDocumentVersion, findDocumentVersionInOrg } from './version-repository'
import { maySeeHeld } from '@/lib/upload-screening/quarantine-reviewers'
import {
  readVersionContent,
  readVersionForService,
  readVersionTextForTask,
  versionBytesReadableBy,
} from './version-content'
import { agentDocument, document, session, version } from './version-content.fixtures'

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

describe('readVersionForService — the conversation is part of the predicate', () => {
  const body = { transformToString: async () => '# Aktenvermerk' }

  beforeEach(() => {
    vi.mocked(findDocumentVersionInOrg).mockResolvedValue(version())
    vi.mocked(findDocumentInOrg).mockResolvedValue(agentDocument)
    vi.mocked(s3Client.send).mockResolvedValue({ Body: body } as never)
  })

  it('serves the bytes when the version IS that conversation’s subject', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValue({
      subjectResourceType: 'document',
      subjectResourceId: 'doc_1',
    } as never)

    await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).resolves.toMatchObject({
      documentId: 'doc_1',
      content: '# Aktenvermerk',
      state: 'draft',
    })
  })

  it('answers 404 for a conversation about a DIFFERENT document', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValue({
      subjectResourceType: 'document',
      subjectResourceId: 'doc_other',
    } as never)

    await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).rejects.toMatchObject({
      status: 404,
    })
  })

  it('answers 404 for a quarantined subject, so its bytes never reach a model (ADR-0086)', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValue({
      subjectResourceType: 'document',
      subjectResourceId: 'doc_1',
    } as never)
    const held = { ...agentDocument, status: 'quarantined' as const }
    vi.mocked(findDocumentInOrg).mockImplementation(async (_id, _org, reader) =>
      mayReadDocument(held, reader) ? held : null
    )

    await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).rejects.toMatchObject({ status: 404 })
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('answers 404 for an upload whose screening has not passed yet (ADR-0086)', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValue({
      subjectResourceType: 'document',
      subjectResourceId: 'doc_1',
    } as never)
    const pending = { ...agentDocument, authoredBy: 'user' as const, status: 'pending' as const, screeningOutcome: null }
    vi.mocked(findDocumentInOrg).mockImplementation(async (_id, _org, reader) =>
      mayReadDocument(pending, reader) ? pending : null
    )

    await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).rejects.toMatchObject({ status: 404 })
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  describe('the bytes the screen judged, not the item', () => {
    const screened = makeDocument({
      id: 'doc_1',
      projectId: 'proj_1',
      contentHash: 'sha256:now',
      screenedHash: 'sha256:now',
      screeningOutcome: 'clean',
    })

    beforeEach(() => {
      vi.mocked(findConversationInOrg).mockResolvedValue({
        subjectResourceType: 'document',
        subjectResourceId: 'doc_1',
      } as never)
      vi.mocked(findDocumentInOrg).mockImplementation(async (_id, _org, reader) =>
        mayReadDocument(screened, reader) ? screened : null
      )
    })

    it('answers 404 for an earlier upload of a screened document whose bytes no verdict judged', async () => {
      vi.mocked(findDocumentVersionInOrg).mockResolvedValue(version({ state: 'superseded', contentHash: 'sha256:before' }))

      await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).rejects.toMatchObject({ status: 404 })
      expect(s3Client.send).not.toHaveBeenCalled()
    })

    it('serves an earlier upload whose own verdict passed its bytes (migration 0131)', async () => {
      vi.mocked(findDocumentVersionInOrg).mockResolvedValue(
        version({ state: 'superseded', contentHash: 'sha256:before', screenedHash: 'sha256:before' }),
      )

      await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).resolves.toMatchObject({ content: '# Aktenvermerk' })
    })

    it('answers 404 for an earlier upload whose own verdict judged other bytes than it holds now', async () => {
      vi.mocked(findDocumentVersionInOrg).mockResolvedValue(
        version({ state: 'superseded', contentHash: 'sha256:before', screenedHash: 'sha256:other' }),
      )

      await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).rejects.toMatchObject({ status: 404 })
    })

    it('serves the version that holds the bytes the verdict judged', async () => {
      vi.mocked(findDocumentVersionInOrg).mockResolvedValue(version({ state: 'published', contentHash: 'sha256:now' }))

      await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).resolves.toMatchObject({ content: '# Aktenvermerk' })
    })

    it('serves a draft, whose text was written in the workflow rather than uploaded', async () => {
      vi.mocked(findDocumentVersionInOrg).mockResolvedValue(version({ state: 'draft', contentHash: 'sha256:edited' }))

      await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).resolves.toMatchObject({ content: '# Aktenvermerk' })
    })
  })

  it('answers 404 for an ordinary chat, which is about nothing', async () => {
    vi.mocked(findConversationInOrg).mockResolvedValue({
      subjectResourceType: null,
      subjectResourceId: null,
    } as never)

    await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).rejects.toMatchObject({
      status: 404,
    })
  })

  describe('a subject in a folder not every member may read (ADR-0087, ADR-0088)', () => {
    const RESTRICTED = 'proj_abc_r0123456789ab'
    const ANSWER_ID = '0b7c6d2e-5f1a-5c3b-9d4e-8f7a6b5c4d3e'
    beforeEach(() => {
      vi.mocked(findConversationInOrg).mockResolvedValue({
        subjectResourceType: 'document',
        subjectResourceId: 'doc_1',
      } as never)
      vi.mocked(findDocumentInOrg).mockResolvedValue({ ...agentDocument, folderId: 'folder_vertraege' })
      vi.mocked(placementCollectionFor).mockResolvedValue(RESTRICTED)
    })

    it('admits the folder for the conversation before the bytes leave, and says so', async () => {
      vi.mocked(admitRestrictedUse).mockResolvedValue({ admitted: [RESTRICTED], refused: [], recorded: ['folder_vertraege'] })

      await expect(readVersionForService('ver_1', 'org_1', 'conv_1', { askerUserId: 'user_asker', answerMessageId: ANSWER_ID })).resolves.toMatchObject({
        content: '# Aktenvermerk',
        drewOnRestrictedFolder: true,
      })
      expect(admitRestrictedUse).toHaveBeenCalledWith(
        {
          organizationId: 'org_1',
          conversationId: 'conv_1',
          userId: 'user_asker',
          projectId: 'proj_1',
          answerMessageId: ANSWER_ID,
        },
        [RESTRICTED],
      )
    })

    it('reads as no subject when the admission is refused, or there is no asker to check', async () => {
      vi.mocked(admitRestrictedUse).mockResolvedValue({ admitted: [], refused: [RESTRICTED], recorded: [] })
      await expect(readVersionForService('ver_1', 'org_1', 'conv_1', { askerUserId: 'user_asker', answerMessageId: ANSWER_ID })).rejects.toMatchObject({
        status: 404,
      })
      await expect(readVersionForService('ver_1', 'org_1', 'conv_1')).rejects.toMatchObject({ status: 404 })
      expect(s3Client.send).not.toHaveBeenCalled()
    })
  })

  it('answers 404 across tenants, indistinguishably from an id that never existed', async () => {
    vi.mocked(findDocumentVersionInOrg).mockResolvedValue(null)
    await expect(readVersionForService('ver_1', 'org_other', 'conv_1')).rejects.toMatchObject({
      status: 404,
    })
    expect(s3Client.send).not.toHaveBeenCalled()
  })
})

describe('reading a version’s text, and the download log', () => {
  beforeEach(() => {
    vi.mocked(findDocumentVersion).mockResolvedValue(version())
    vi.mocked(s3Client.send).mockResolvedValue({ Body: { transformToString: async () => '# Aktenvermerk' } } as never)
  })

  it('records the hand-over to the person, naming the version they opened', async () => {
    await expect(readVersionContent(session, 'doc_1', 'ver_1')).resolves.toBe('# Aktenvermerk')

    expect(recordDocumentAccess).toHaveBeenCalledWith(session, document, 'version', { versionId: 'ver_1' })
  })

  it('records nothing for a version that does not exist', async () => {
    vi.mocked(findDocumentVersion).mockResolvedValue(null)

    await expect(readVersionContent(session, 'doc_1', 'ver_9')).rejects.toMatchObject({ status: 404 })

    expect(recordDocumentAccess).not.toHaveBeenCalled()
  })

  it('does not hand the text over when the log refuses (a folder with its own list)', async () => {
    vi.mocked(recordDocumentAccess).mockRejectedValueOnce(Object.assign(new Error('not recorded'), { status: 503 }))

    await expect(readVersionContent(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 503 })
  })

  it.each([
    ['quarantined', { status: 'quarantined' as const, screeningOutcome: 'quarantined' as const }],
    ['still being screened', { status: 'processing' as const, screeningOutcome: null }],
  ])('refuses the agent task a document that is %s, before reading a byte', async (_label, held) => {
    vi.mocked(getAccessibleDocument).mockResolvedValueOnce({ ...document, ...held })

    await expect(readVersionTextForTask(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 404 })
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('refuses the agent task an earlier upload whose bytes no verdict judged, before reading a byte', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValueOnce({
      ...document,
      contentHash: 'sha256:now',
      screenedHash: 'sha256:now',
      screeningOutcome: 'clean',
    })
    vi.mocked(findDocumentVersion).mockResolvedValueOnce(version({ state: 'superseded', contentHash: 'sha256:before' }))

    await expect(readVersionTextForTask(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 404 })
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  describe('an earlier upload whose bytes no verdict judged (ADR-0086)', () => {
    const screened = { ...document, contentHash: 'sha256:now', screenedHash: 'sha256:now', screeningOutcome: 'clean' as const }

    beforeEach(() => {
      vi.mocked(getAccessibleDocument).mockResolvedValue(screened)
      vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'superseded', contentHash: 'sha256:before' }))
    })

    it('refuses its text to a member, before reading a byte or recording anything', async () => {
      await expect(readVersionContent(session, 'doc_1', 'ver_1')).rejects.toMatchObject({ status: 404 })

      expect(maySeeHeld).toHaveBeenCalledWith(session, screened)
      expect(s3Client.send).not.toHaveBeenCalled()
      expect(recordDocumentAccess).not.toHaveBeenCalled()
    })

    it('hands its text to the uploader or a reviewer, who may see what is held', async () => {
      vi.mocked(maySeeHeld).mockResolvedValue(true)

      await expect(readVersionContent(session, 'doc_1', 'ver_1')).resolves.toBe('# Aktenvermerk')
    })

    it('hands a member the text of an earlier upload whose own verdict passed it (migration 0131)', async () => {
      vi.mocked(findDocumentVersion).mockResolvedValue(
        version({ state: 'superseded', contentHash: 'sha256:before', screenedHash: 'sha256:before' }),
      )

      await expect(readVersionContent(session, 'doc_1', 'ver_1')).resolves.toBe('# Aktenvermerk')
      expect(maySeeHeld).not.toHaveBeenCalled()
      expect(recordDocumentAccess).toHaveBeenCalledWith(session, screened, 'version', { versionId: 'ver_1' })
    })

    it('hands a member the text of the version whose bytes the verdict judged', async () => {
      vi.mocked(findDocumentVersion).mockResolvedValue(version({ state: 'published', contentHash: 'sha256:now' }))

      await expect(readVersionContent(session, 'doc_1', 'ver_1')).resolves.toBe('# Aktenvermerk')
      expect(maySeeHeld).not.toHaveBeenCalled()
    })
  })

  it('does not record the read that feeds an agent task: the reviewer never receives those bytes', async () => {
    await expect(readVersionTextForTask(session, 'doc_1', 'ver_1')).resolves.toBe('# Aktenvermerk')

    expect(recordDocumentAccess).not.toHaveBeenCalled()
  })
})

describe('versionBytesReadableBy — the version list asks the rule once', () => {
  const screened = { ...document, contentHash: 'sha256:now', screenedHash: 'sha256:now', screeningOutcome: 'clean' as const }
  const current = version({ id: 'ver_2', state: 'published', contentHash: 'sha256:now' })
  const earlier = version({ id: 'ver_1', state: 'superseded', contentHash: 'sha256:before' })

  it('asks nobody when every version holds judged bytes or workflow text', async () => {
    const readable = await versionBytesReadableBy(session, screened, [current, version({ state: 'draft' })])

    expect(readable(current)).toBe(true)
    expect(maySeeHeld).not.toHaveBeenCalled()
  })

  it('refuses a member the earlier upload no verdict judged, and asks who may see what is held once', async () => {
    const readable = await versionBytesReadableBy(session, screened, [current, earlier, { ...earlier, id: 'ver_0' }])

    expect([readable(current), readable(earlier)]).toEqual([true, false])
    expect(maySeeHeld).toHaveBeenCalledTimes(1)
  })

  it('lets the uploader or a reviewer open it', async () => {
    vi.mocked(maySeeHeld).mockResolvedValue(true)

    const readable = await versionBytesReadableBy(session, screened, [current, earlier])

    expect(readable(earlier)).toBe(true)
  })

  it('offers a member every earlier upload whose own verdict passed, and not the one replaced unread (migration 0131)', async () => {
    const screenedEarlier = version({ id: 'ver_0', state: 'superseded', contentHash: 'sha256:first', screenedHash: 'sha256:first' })
    const swapped = version({ id: 'ver_x', state: 'superseded', contentHash: 'sha256:edited', screenedHash: 'sha256:first' })

    const readable = await versionBytesReadableBy(session, screened, [screenedEarlier, earlier, swapped, current])

    expect([screenedEarlier, earlier, swapped, current].map(readable)).toEqual([true, false, false, true])
  })

  it('asks nobody when every earlier upload carries a passing verdict of its own', async () => {
    const screenedEarlier = { ...earlier, screenedHash: 'sha256:before' }

    const readable = await versionBytesReadableBy(session, screened, [screenedEarlier, current])

    expect(readable(screenedEarlier)).toBe(true)
    expect(maySeeHeld).not.toHaveBeenCalled()
  })

  it('offers nothing of a held item through its versions, whatever they record', async () => {
    const held = { ...screened, status: 'quarantined' as const, screeningOutcome: 'quarantined' as const }
    const screenedEarlier = { ...earlier, screenedHash: 'sha256:before' }

    const readable = await versionBytesReadableBy(session, held, [screenedEarlier, current])

    expect([readable(screenedEarlier), readable(current)]).toEqual([false, false])
  })
})
