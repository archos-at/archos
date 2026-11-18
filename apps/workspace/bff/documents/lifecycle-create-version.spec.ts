/**
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DocumentVersion } from '@/lib/db/schema/document-versions'

vi.mock('./access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('./version-repository', () => ({
  findDocumentVersion: vi.fn(),
  findOpenVersion: vi.fn(),
  findPreviousVersion: vi.fn().mockResolvedValue(null),
  findPublishedVersion: vi.fn(),
  insertDocumentVersion: vi.fn(),
  insertPublishedVersion: vi.fn(),
  listDocumentVersions: vi.fn(),
  nextVersionNumber: vi.fn().mockResolvedValue(2),
  compareAndSwapVersionState: vi.fn(),
  promoteVersionToPublished: vi.fn(),
  setDocumentLifecycle: vi.fn(),
  listDocumentVersionObjects: vi.fn().mockResolvedValue([]),
  listDocumentVersionSummaries: vi.fn().mockResolvedValue([]),
}))
vi.mock('./repository', () => ({
  findDocumentInOrg: vi.fn(),
  findFolderPathInProject: vi.fn().mockResolvedValue('Berichte'),
}))
vi.mock('./document-dispatch', () => ({
  dispatchDocument: vi.fn(),
  AgentAuthoredDocumentNotIndexableError: class AgentAuthoredDocumentNotIndexableError extends Error {},
}))
vi.mock('@/lib/sharing/directory', () => ({ resolvePeople: vi.fn() }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/audit/service', () => ({ recordAuditEvent: vi.fn() }))
vi.mock('@/lib/events/bus', () => ({ publishToUsers: vi.fn() }))
vi.mock('./reviewers', () => ({
  listReviewCandidates: vi.fn(),
  resolveReviewers: vi.fn(),
}))
vi.mock('./version-content', () => ({
  BACKEND_PURGE_TIMEOUT_MS: 10_000,
  readVersionTextForTask: vi.fn().mockResolvedValue('# Aktenvermerk'),
  renderVersionBytes: vi.fn(),
  versionBytesReadableBy: vi.fn(),
  writeVersionContent: vi.fn(),
}))
vi.mock('@/lib/storage/discard', () => ({ discardObject: vi.fn() }))
vi.mock('./revision-notify', () => ({ announceNewRevision: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/inbox/service', () => ({ emitInboxItems: vi.fn(), resolveInboxItemsFor: vi.fn() }))

import { getAccessibleDocument } from './access'
import { findDocumentInOrg } from './repository'
import { discardObject } from '@/lib/storage/discard'
import { dispatchDocument } from './document-dispatch'
import { announceNewRevision } from './revision-notify'
import { resolvePeople } from '@/lib/sharing/directory'
import { recordAuditEvent } from '@/lib/audit/service'
import { listReviewCandidates, resolveReviewers } from './reviewers'
import { emitInboxItems } from '@/lib/inbox/service'
import { makeDocument } from '@/test-utils/db-fixtures'
import {
  findDocumentVersion,
  findOpenVersion,
  findPublishedVersion,
  insertDocumentVersion,
  insertPublishedVersion,
  promoteVersionToPublished,
} from './version-repository'
import { renderVersionBytes, writeVersionContent } from './version-content'
import { DocumentDeletedError, OpenVersionExistsError } from './unique-conflicts'
import {
  createDocumentVersion,
  forkDraftVersion,
  recordUploadedVersion,
  recordUploadedVersionOrDiscard,
  transitionDocumentVersion,
} from './lifecycle'
import { session, document, version } from './lifecycle.fixtures'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolvePeople).mockResolvedValue(
    new Map([
      ['user_approver', { userId: 'user_approver', email: null, name: 'Maria Huber', profilePictureUrl: null }],
    ]),
  )
  vi.mocked(getAccessibleDocument).mockResolvedValue(document)
  vi.mocked(listReviewCandidates).mockResolvedValue([
    { userId: 'user_other', name: 'Anna Berger', email: null },
  ])
  vi.mocked(resolveReviewers).mockImplementation(async (_session, _document, named) => ({
    reviewers: named && named.length > 0 ? [...named] : ['user_anna'],
    selfReview: false,
  }))
  vi.mocked(findPublishedVersion).mockResolvedValue(null)
  vi.mocked(findOpenVersion).mockResolvedValue(null)
  vi.mocked(writeVersionContent).mockReset()
  vi.mocked(writeVersionContent).mockImplementation(async ({ version: read, stamp }) => ({
    ...read,
    ...stamp,
  }) as DocumentVersion)
  vi.mocked(renderVersionBytes).mockResolvedValue({
    bytes: Buffer.from('# Aktenvermerk', 'utf8'),
    contentType: 'text/markdown',
    contentHash: `sha256:${'a'.repeat(64)}`,
  })
})

describe('createDocumentVersion — a human upload', () => {
  const upload = () =>
    createDocumentVersion(session, {
      document,
      op: 'upload',
      storageKey: 'k',
      storageBucket: 'b',
      contentType: 'application/pdf',
      fileSize: 10,
      contentHash: 'sha256:x',
    })

  it('is born published as an upload, with no approval nobody gave', async () => {
    vi.mocked(insertPublishedVersion).mockImplementation(async (values) => ({
      version: version({ ...(values as Partial<DocumentVersion>), id: 'ver_new' }),
      superseded: [],
    }))

    await upload()

    const values = vi.mocked(insertPublishedVersion).mock.calls[0][0]
    expect(values).toMatchObject({ state: 'published', origin: 'upload', publishedBy: session.userId })
    expect(values).not.toHaveProperty('approvedBy')
    expect(values).not.toHaveProperty('approvedAt')
  })

  it('inserts the published row INSIDE the supersede transaction, never beside it', async () => {
    vi.mocked(insertPublishedVersion).mockResolvedValue({
      version: version({ id: 'ver_new', state: 'published' }),
      superseded: [version({ id: 'ver_0', state: 'superseded' })],
    })

    await upload()

    expect(insertDocumentVersion).not.toHaveBeenCalled()
    expect(promoteVersionToPublished).not.toHaveBeenCalled()
  })

  it('announces a same-name upload as a new Fassung only when it replaced a version', async () => {
    vi.mocked(insertPublishedVersion).mockImplementation(async (values) => ({
      version: version({ ...(values as Partial<DocumentVersion>), id: 'ver_new' }),
      superseded: [version({ id: 'ver_0', state: 'superseded', createdBy: 'user_first' })],
    }))

    await upload()

    expect(announceNewRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org_1',
        actorUserId: session.userId,
        newerId: 'doc_1',
        olderId: 'doc_1',
        versionId: 'ver_new',
        previousUploaderIds: ['user_first'],
      }),
    )

    vi.mocked(announceNewRevision).mockClear()
    vi.mocked(insertPublishedVersion).mockImplementation(async (values) => ({
      version: version({ ...(values as Partial<DocumentVersion>), id: 'ver_first' }),
      superseded: [],
    }))

    await upload()

    expect(announceNewRevision).not.toHaveBeenCalled()
  })

  it('refuses an upload claimed by a machine caller', async () => {
    await expect(
      createDocumentVersion(session, {
        document,
        op: 'upload',
        storageKey: 'k',
        storageBucket: null,
        contentType: null,
        fileSize: null,
        contentHash: null,
        actingHuman: false,
      }),
    ).rejects.toMatchObject({ status: 403 })
  })
})

describe('createDocumentVersion — a person files a draft the agent made', () => {
  const agentFile = makeDocument({
    id: 'doc_1',
    projectId: 'proj_1',
    authoredBy: 'agent',
    authoredByProducer: 'agent_file',
    filename: 'generated/doc_1/Raumbuch.xlsx',
  })
  const filer = { ...session, userId: 'user_approver' }
  const file = (actingHuman?: boolean) =>
    createDocumentVersion(filer, {
      document: agentFile,
      op: 'file',
      storageKey: 'k',
      storageBucket: 'b',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 10,
      contentHash: 'sha256:x',
      actingHuman,
    })

  beforeEach(() => {
    vi.mocked(insertPublishedVersion).mockImplementation(async (values) => ({
      version: version({ ...(values as Partial<DocumentVersion>), id: 'ver_filed', submittedBy: null }),
      superseded: [],
    }))
    vi.mocked(findDocumentInOrg).mockResolvedValue(agentFile)
  })

  it('is born published, signed off by the person who filed it, with no review step', async () => {
    await file()

    const values = vi.mocked(insertPublishedVersion).mock.calls[0][0]
    expect(values).toMatchObject({ state: 'published', origin: 'filing', publishedBy: 'user_approver' })
    expect(values).not.toHaveProperty('approvedBy')
    expect(values).not.toHaveProperty('submittedBy')
    expect(insertDocumentVersion).not.toHaveBeenCalled()
  })

  it('is indexed at once, and its provenance names the filer as the person who signed it off', async () => {
    await file()

    expect(dispatchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        documentId: 'doc_1',
        versionId: 'ver_filed',
        provenance: expect.objectContaining({ authored_by: 'agent', approved_by: 'Maria Huber', producer: 'agent_file' }),
      }),
    )
  })

  it('publishes a Fassung filed again the same way, as the filer’s and with no approval nobody gave', async () => {
    vi.mocked(getAccessibleDocument).mockResolvedValue(agentFile)
    vi.mocked(findDocumentVersion).mockResolvedValue(version({ id: 'ver_2', state: 'draft', submittedBy: null }))
    vi.mocked(promoteVersionToPublished).mockImplementation(async (id, _doc, _org, _expected, stamp) => ({
      version: version({ ...(stamp as Partial<DocumentVersion>), id }),
      superseded: [version({ id: 'ver_1', state: 'superseded' })],
    }))

    await transitionDocumentVersion(filer, 'doc_1', 'ver_2', 'file', { actingHuman: false })

    const stamp = vi.mocked(promoteVersionToPublished).mock.calls[0][4]
    expect(stamp).toMatchObject({ state: 'published', origin: 'filing', publishedBy: 'user_approver' })
    expect(stamp).not.toHaveProperty('approvedBy')
    expect(dispatchDocument).toHaveBeenCalledWith(expect.objectContaining({ versionId: 'ver_2' }))
    expect(emitInboxItems).not.toHaveBeenCalled()
  })

  it('asks nobody to review it', async () => {
    await file(false)

    expect(emitInboxItems).not.toHaveBeenCalled()
    expect(resolveReviewers).not.toHaveBeenCalled()
  })
})

describe('forkDraftVersion', () => {
  it('refuses a second open version and names the one that exists', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(version({ id: 'ver_open', state: 'draft' }))
    await expect(forkDraftVersion(session, 'doc_1')).rejects.toMatchObject({
      status: 409,
      details: { versionId: 'ver_open', state: 'draft' },
    })
  })

  it('answers the loser of two concurrent forks with the same 409, naming the winner', async () => {
    vi.mocked(findOpenVersion)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(version({ id: 'ver_winner', state: 'draft' }))
    vi.mocked(findPublishedVersion).mockResolvedValue(version({ state: 'published' }))
    vi.mocked(insertDocumentVersion).mockRejectedValue(new OpenVersionExistsError('doc_1'))

    await expect(forkDraftVersion(session, 'doc_1')).rejects.toMatchObject({
      status: 409,
      code: 'CONFLICT',
      details: { versionId: 'ver_winner', state: 'draft' },
    })
  })

  it('lets any other insert failure through unmapped', async () => {
    vi.mocked(findOpenVersion).mockResolvedValue(null)
    vi.mocked(findPublishedVersion).mockResolvedValue(version({ state: 'published' }))
    const other = new Error('Failed query', { cause: { code: '23505', constraint_name: 'other' } })
    vi.mocked(insertDocumentVersion).mockRejectedValue(other)

    await expect(forkDraftVersion(session, 'doc_1')).rejects.toBe(other)
  })

  it('shares the published version’s key until the content is replaced', async () => {
    vi.mocked(findPublishedVersion).mockResolvedValue(version({ state: 'published' }))
    vi.mocked(insertDocumentVersion).mockImplementation(async (values) =>
      version({ ...(values as Partial<DocumentVersion>), id: 'ver_fork' }),
    )

    await forkDraftVersion(session, 'doc_1')

    expect(insertDocumentVersion).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'draft',
        storageKey: 'org/org_1/project/proj_1/doc/doc_1/v2/plan.md',
      }),
    )
  })
})

describe('recordUploadedVersionOrDiscard', () => {
  const stored = {
    storageKey: 'org/org_1/project/proj_1/doc/doc_1/v2/abcdef012345/plan.pdf',
    storageBucket: null,
    contentType: 'application/pdf',
    fileSize: 1234,
    contentHash: 'sha256:new',
  }

  it('refuses with a 409 and takes the stored object back when the document is already gone', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValueOnce(null)

    await expect(recordUploadedVersionOrDiscard(session, 'doc_1', undefined, stored)).rejects.toBeInstanceOf(
      DocumentDeletedError,
    )
    expect(discardObject).toHaveBeenCalledWith(expect.any(String), stored.storageKey)
    expect(insertPublishedVersion).not.toHaveBeenCalled()
    expect(dispatchDocument).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('does the same when the delete lands between the lookup and the insert', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValueOnce(document)
    vi.mocked(insertPublishedVersion).mockRejectedValueOnce(new DocumentDeletedError('doc_1'))

    await expect(recordUploadedVersionOrDiscard(session, 'doc_1', undefined, stored)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'deleted_during_upload' },
    })
    expect(discardObject).toHaveBeenCalledWith(expect.any(String), stored.storageKey)
  })

  it('lets any other failure through without discarding a byte', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValueOnce(document)
    const boom = new Error('boom')
    vi.mocked(insertPublishedVersion).mockRejectedValueOnce(boom)

    await expect(recordUploadedVersionOrDiscard(session, 'doc_1', undefined, stored)).rejects.toBe(boom)
    expect(discardObject).not.toHaveBeenCalled()
  })

  it('leaves the lenient form returning null for the shelf that reads no answer', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValueOnce(document)
    vi.mocked(insertPublishedVersion).mockRejectedValueOnce(new DocumentDeletedError('doc_1'))

    await expect(recordUploadedVersion(session, 'doc_1', undefined, stored)).resolves.toBeNull()
    expect(discardObject).not.toHaveBeenCalled()
  })
})
