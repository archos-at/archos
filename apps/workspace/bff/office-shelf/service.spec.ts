import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/documents/version-repository', () => ({
  DOCUMENT_VERSION_LIST_LIMIT: 200,
  insertDocumentVersion: vi.fn(async (values: Record<string, unknown>) => ({
    id: 'version_1',
    state: 'published',
    versionNumber: 1,
    ...values,
  })),
  insertPublishedVersion: vi.fn(async (values: Record<string, unknown>) => ({
    version: { id: 'version_1', state: 'published', versionNumber: 1, ...values },
    superseded: [],
  })),
  listDocumentVersions: vi.fn().mockResolvedValue([]),
  findDocumentVersion: vi.fn().mockResolvedValue(null),
  findPublishedVersion: vi.fn().mockResolvedValue(null),
  findOpenVersion: vi.fn().mockResolvedValue(null),
  listDocumentVersionSummaries: vi.fn().mockResolvedValue([]),
  nextVersionNumber: vi.fn().mockResolvedValue(2),
  compareAndSwapVersionState: vi.fn().mockResolvedValue(null),
  promoteVersionToPublished: vi.fn().mockResolvedValue(null),
  setDocumentLifecycle: vi.fn(),
  listDocumentVersionObjects: vi.fn().mockResolvedValue([]),
}))

vi.mock('@/lib/storage/service', () => ({
  assertWithinStorageQuota: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/authz/organizations', () => ({
  canManageOfficeShelf: vi.fn(),
}))

vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn().mockResolvedValue(undefined) },
  bucketAdminS3Client: { send: vi.fn().mockResolvedValue(undefined) },
  bucketName: 'test-bucket',
}))

vi.mock('@/lib/backend-proxy', () => ({
  getBackendUrl: vi.fn().mockReturnValue('http://backend:8000'),
}))

vi.mock('@/lib/organizations/service', () => ({
  getOrgSettings: vi.fn(async () => ({ displayName: null, defaultLocale: 'de', settings: {} })),
  writeDedicatedOrgSetting: vi.fn(),
}))
vi.mock('@/lib/audit/service', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/documents/upload-type', () => ({ assertUploadTypeAllowed: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/storage/upload-limit', () => ({ assertFileSizeAllowed: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/documents/document-dispatch', () => ({
  dispatchDocument: vi.fn().mockResolvedValue({ jobId: 'job-1', status: 'pending' }),
}))

vi.mock('@/lib/documents/reconcile-status', () => ({
  reconcileDocumentStatuses: vi.fn(),
}))
vi.mock('@/lib/documents/revision-links-loader', () => ({ loadRevisionLinks: vi.fn(async () => new Map()) }))
vi.mock('@/lib/annotations/repository', () => ({ tallyLiveMarks: vi.fn(async () => new Map()) }))

vi.mock('@/lib/documents/repository', () => ({
  findLiveDocumentByFilename: vi.fn().mockResolvedValue(null),
  findFolderPathInOfficeShelf: vi.fn().mockResolvedValue(null),
  findDocumentInOrg: vi.fn(async (id: string) =>
    (await import('@/test-utils/db-fixtures')).makeDocument({ id, projectId: null, scope: 'office_shelf' }),
  ),
}))

vi.mock('@/lib/storage/admission', () => ({
  admitOrDiscard: vi.fn().mockResolvedValue(undefined),
  admitReplacementOrDiscard: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/documents/object-cleanup', () => ({
  eraseDocumentObjectsOrKeepRow: vi.fn().mockResolvedValue({ versionsLeft: 0 }),
}))

vi.mock('@/lib/compliance/repository', () => ({
  isCoveredByActiveHold: vi.fn().mockResolvedValue(false),
}))

vi.mock('./repository', () => ({
  listOfficeShelfDocumentLevel: vi.fn(),
  findOfficeShelfDocumentsByFilenames: vi.fn(),
  findOfficeShelfDocumentsByNames: vi.fn().mockResolvedValue([]),
  findOfficeShelfDocument: vi.fn(),
  deleteOfficeShelfDocument: vi.fn().mockResolvedValue(undefined),
}))

import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { dispatchDocument } from '@/lib/documents/document-dispatch'
import { assertUploadTypeAllowed } from '@/lib/documents/upload-type'
import { reconcileDocumentStatuses } from '@/lib/documents/reconcile-status'
import { recordAuditEvent } from '@/lib/audit/service'
import { ConflictError, ForbiddenError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import { isCoveredByActiveHold } from '@/lib/compliance/repository'
import { eraseDocumentObjectsOrKeepRow } from '@/lib/documents/object-cleanup'
import { s3Client } from '@/lib/s3'
import { admitOrDiscard, admitReplacementOrDiscard } from '@/lib/storage/admission'
import { findDocumentInOrg, findFolderPathInOfficeShelf, findLiveDocumentByFilename } from '@/lib/documents/repository'
import { LiveFilenameTakenError, ReplacedDocumentGoneError } from '@/lib/documents/unique-conflicts'
import {
  listOfficeShelfDocumentLevel,
  findOfficeShelfDocument,
  findOfficeShelfDocumentsByFilenames,
  findOfficeShelfDocumentsByNames,
  deleteOfficeShelfDocument as deleteOfficeShelfDocumentRow,
} from './repository'
import { encodeDocumentLevelCursor } from '@/lib/documents/list-cursor'

const LEVEL = { folderId: undefined, sort: 'added', dir: 'desc', limit: 100 } as const
import {
  listOfficeShelf,
  uploadOfficeShelfDocument,
  deleteOfficeShelfDocument,
  probeOfficeShelfDocumentNames,
  resolveOfficeShelfDocumentsByName,
} from './service'
import { makeDocument, makeLiveDocumentMatch } from '@/test-utils/db-fixtures'
import type { AuthorizedSession } from '@/lib/auth/types'
import type { DocumentMetadata, ReconcilableDocument } from '@/lib/documents/reconcile-status'

const session: AuthorizedSession = {
  userId: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  accessToken: 'test-access-token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'member',
  permissions: [],
  featureFlags: null,
}

const makeFile = (name = 'plan.pdf') =>
  ({
    name,
    size: 1024,
    type: 'application/pdf',
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
  }) as unknown as File

const request = new Request('http://localhost/api/office-shelf/documents/upload')

beforeEach(() => {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'doc-uuid' })
  }
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('listOfficeShelf', () => {
  it('returns the org archive collection name and the caller manage flag', async () => {
    vi.mocked(listOfficeShelfDocumentLevel).mockResolvedValue({ rows: [], nextCursor: null })
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)

    const result = await listOfficeShelf(session, { level: LEVEL })

    expect(result.collectionName).toBe('archiv_org-1')
    expect(result.canManage).toBe(true)
    expect(listOfficeShelfDocumentLevel).toHaveBeenCalledWith('org-1', { level: LEVEL, reader: { kind: 'reviewer' } })
    expect(result.nextCursor).toBeNull()
  })

  it('encodes the next page position', async () => {
    const next = { sort: 'added', dir: 'desc', value: '2026-01-01T00:00:00.123456', id: '00000000-0000-4000-8000-000000000001' } as const
    vi.mocked(listOfficeShelfDocumentLevel).mockResolvedValue({ rows: [], nextCursor: next })
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])

    const result = await listOfficeShelf(session, { level: LEVEL })

    expect(result.nextCursor).toBe(encodeDocumentLevelCursor(next))
  })

  it('narrows again after the reconcile turns a row quarantined (ADR-0086)', async () => {
    const row = (id: string, createdBy: string) =>
      ({ id, filename: `${id}.pdf`, status: 'pending', createdBy, metadata: null }) as never
    vi.mocked(listOfficeShelfDocumentLevel).mockResolvedValue({ rows: [row('mine', 'user-1'), row('theirs', 'user-2')], nextCursor: null })
    vi.mocked(reconcileDocumentStatuses).mockImplementation(async (rows) =>
      rows.map((r) => ({ ...r, status: 'quarantined' }))
    )
    vi.mocked(canManageOfficeShelf).mockReturnValue(false)

    const result = await listOfficeShelf(session, { level: LEVEL })

    expect(result.documents.map((doc) => doc.id)).toEqual(['mine'])
  })

  it('strips the internal metadata jsonb from every returned row', async () => {
    vi.mocked(listOfficeShelfDocumentLevel).mockResolvedValue({ rows: [], nextCursor: null })
    const reconciled: Array<ReconcilableDocument & DocumentMetadata> = [
      {
        id: 'd1',
        filename: 'a.pdf',
        status: 'completed',
        collectionName: 'archiv_org-1',
        authoredBy: 'user',
        publishedVersionId: null,
        errorMessage: null,
        metadata: { ingestJobId: 'secret' },
        summary: 's',
      },
    ]
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue(reconciled)
    vi.mocked(canManageOfficeShelf).mockReturnValue(false)

    const result = await listOfficeShelf(session, { level: LEVEL })

    expect(result.canManage).toBe(false)
    expect(result.documents[0]).not.toHaveProperty('metadata')
    expect(result.documents[0]).toMatchObject({ id: 'd1', summary: 's' })
  })

  it('passes the lifecycle and author filters to the shelf listing', async () => {
    vi.mocked(listOfficeShelfDocumentLevel).mockResolvedValue({ rows: [], nextCursor: null })
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])
    vi.mocked(canManageOfficeShelf).mockReturnValue(false)

    await listOfficeShelf(session, { includeArchived: true, authoredBy: 'agent', level: LEVEL })

    expect(listOfficeShelfDocumentLevel).toHaveBeenCalledWith('org-1', {
      includeArchived: true,
      authoredBy: 'agent',
      level: LEVEL,
      reader: { kind: 'member', userId: 'user-1' },
    })
  })

  it('lists every quarantined file to a curator of the Büroablage (ADR-0086)', async () => {
    vi.mocked(listOfficeShelfDocumentLevel).mockResolvedValue({ rows: [], nextCursor: null })
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)

    await listOfficeShelf(session, { level: LEVEL })

    expect(vi.mocked(listOfficeShelfDocumentLevel).mock.calls[0][1]).toEqual({ level: LEVEL, reader: { kind: 'reviewer' } })
  })

  it('hydrates rows exactly as a project listing does', async () => {
    vi.mocked(listOfficeShelfDocumentLevel).mockResolvedValue({ rows: [], nextCursor: null })
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([
      {
        id: 'd1',
        filename: 'a.pdf',
        status: 'completed',
        collectionName: 'archiv_org-1',
        authoredBy: 'user',
        publishedVersionId: null,
        errorMessage: null,
        metadata: {},
      },
    ])

    const result = await listOfficeShelf(session, { level: LEVEL })

    expect(result.documents[0]).toMatchObject({ id: 'd1', assignees: [] })
  })
})

describe('resolveOfficeShelfDocumentsByName', () => {
  it('looks the names up directly and hydrates them like the listing', async () => {
    const row = {
      id: 'd9',
      filename: 'Alt.pdf',
      createdAt: new Date('2019-01-01T00:00:00Z'),
      status: 'completed',
      collectionName: 'archiv_org-1',
      errorMessage: null,
      authoredBy: 'user',
      publishedVersionId: null,
    }
    vi.mocked(findOfficeShelfDocumentsByFilenames).mockResolvedValue([row] as never)
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([{ ...row, metadata: {} }] as never)

    vi.mocked(canManageOfficeShelf).mockReturnValue(false)
    const documents = await resolveOfficeShelfDocumentsByName(session, ['alt.pdf'])

    expect(findOfficeShelfDocumentsByFilenames).toHaveBeenCalledWith('org-1', ['alt.pdf'], { reader: { kind: 'member', userId: 'user-1' } })
    expect(listOfficeShelfDocumentLevel).not.toHaveBeenCalled()
    expect(documents.map((doc) => doc.id)).toEqual(['d9'])
    expect(documents[0]).not.toHaveProperty('metadata')
  })
})

describe('uploadOfficeShelfDocument', () => {
  it('rejects callers without org:office_shelf:manage (403)', async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(false)

    await expect(uploadOfficeShelfDocument(session, makeFile(), request)).rejects.toBeInstanceOf(ForbiddenError)
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(assertUploadTypeAllowed).not.toHaveBeenCalled()
  })

  it('stores, records, dispatches ingest, and audits on the happy path', async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)

    const result = await uploadOfficeShelfDocument(session, makeFile(), request)

    expect(assertUploadTypeAllowed).toHaveBeenCalledWith(session, 'plan.pdf')
    expect(admitOrDiscard).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ organizationId: 'org-1', scope: 'office_shelf', projectId: null, collectionName: 'archiv_org-1' }),
    )
    expect(dispatchDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        projectId: null,
        filename: 'plan.pdf',
        collectionName: 'archiv_org-1',
        storageKey: expect.stringMatching(/^org\/org-1\/office_shelf\/doc\/[^/]+\/plan\.pdf$/),
        storageBucket: 'test-bucket',
      }),
    )
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'office_shelf.document.uploaded', organizationId: 'org-1' }),
    )
    expect(result).toMatchObject({ jobId: 'job-1', status: 'pending', filename: 'plan.pdf' })
  })

  describe('into a folder', () => {
    beforeEach(() => {
      vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    })

    it('files the document in an Archiv folder and tells the backend its PATH', async () => {
      vi.mocked(findFolderPathInOfficeShelf).mockResolvedValueOnce('Normen/Brandschutz')

      await uploadOfficeShelfDocument(session, makeFile(), request, {
        folderId: 'folder-1',
        originPath: 'Normen/Brandschutz/plan.pdf',
      })

      expect(findFolderPathInOfficeShelf).toHaveBeenCalledWith('folder-1', 'org-1')
      expect(admitOrDiscard).toHaveBeenCalledWith(
        expect.any(String),
        expect.stringMatching(/^org\/org-1\/office_shelf\/Normen\/Brandschutz\/doc\/[^/]+\/plan\.pdf$/),
        expect.objectContaining({
          scope: 'office_shelf',
          projectId: null,
          folderId: 'folder-1',
          originPath: 'Normen/Brandschutz/plan.pdf',
        }),
      )
      expect(dispatchDocument).toHaveBeenCalledWith(
        expect.objectContaining({ folderPath: 'Normen/Brandschutz', collectionName: 'archiv_org-1' }),
      )
    })

    it('is a 404 for a folder that is not on this organization\u2019s Archiv shelf', async () => {
      await expect(
        uploadOfficeShelfDocument(session, makeFile(), request, { folderId: 'folder-elsewhere' }),
      ).rejects.toBeInstanceOf(NotFoundError)
      expect(admitOrDiscard).not.toHaveBeenCalled()
      expect(s3Client.send).not.toHaveBeenCalled()
    })

    it('re-files the one document when the same name is uploaded into a different folder', async () => {
      vi.mocked(findFolderPathInOfficeShelf).mockResolvedValueOnce('Pläne')
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue(makeLiveDocumentMatch({
        id: 'archiv-doc-1',
        storageKey: 'org/org-1/archiv/doc/archiv-doc-1/plan.pdf',
        storageBucket: 'test-bucket',
        fileSize: 8,
        contentHash: null,
        folderId: null,
        status: 'ready',
      }))

      const result = await uploadOfficeShelfDocument(session, makeFile(), request, { folderId: 'folder-2' })

      expect(result.documentId).toBe('archiv-doc-1')
      expect(admitReplacementOrDiscard).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'org-1',
        'archiv-doc-1',
        expect.objectContaining({ folderId: 'folder-2' }),
      )
    })

    it('does nothing when the same bytes are already filed where this upload would file them', async () => {
      const { contentDigest } = await import('@/lib/documents/content-digest')
      const digest = contentDigest(Buffer.from(new ArrayBuffer(8)))
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue(makeLiveDocumentMatch({
        id: 'archiv-doc-1',
        storageKey: 'org/org-1/archiv/doc/archiv-doc-1/plan.pdf',
        storageBucket: 'test-bucket',
        fileSize: 8,
        contentHash: digest,
        folderId: null,
        status: 'completed',
      }))

      const result = await uploadOfficeShelfDocument(session, makeFile(), request)

      expect(result).toMatchObject({ documentId: 'archiv-doc-1', unchanged: true, jobId: null })
      expect(s3Client.send).not.toHaveBeenCalled()
      expect(dispatchDocument).not.toHaveBeenCalled()
      expect(recordAuditEvent).not.toHaveBeenCalled()
    })
  })
})

describe('deleteOfficeShelfDocument', () => {
  it('rejects callers without org:office_shelf:manage (403)', async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(false)

    await expect(deleteOfficeShelfDocument(session, 'd1', request)).rejects.toBeInstanceOf(ForbiddenError)
    expect(deleteOfficeShelfDocumentRow).not.toHaveBeenCalled()
  })

  it('404s when the document is not in the org archive', async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    vi.mocked(findOfficeShelfDocument).mockResolvedValue(null)

    await expect(deleteOfficeShelfDocument(session, 'missing', request)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('purges chunks, deletes the row, and audits', async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    vi.mocked(findOfficeShelfDocument).mockResolvedValue(
      makeDocument({
        id: 'd1',
        scope: 'office_shelf',
        projectId: null,
        collectionName: 'archiv_org-1',
        storageKey: 'org/org-1/archiv/doc/d1/plan.pdf',
      }),
    )
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    await deleteOfficeShelfDocument(session, 'd1', request)

    expect(fetchSpy).toHaveBeenCalledWith(
      'http://backend:8000/v1/collections/archiv_org-1/documents',
      expect.objectContaining({ method: 'DELETE' }),
    )
    const deletes = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'DELETE')
    expect(deletes).toHaveLength(2)
    for (const [, init] of deletes) {
      expect(JSON.parse(String((init as RequestInit).body))).toEqual({
        file_ids: ['plan.pdf'],
        documents: [{ id: 'd1', file_name: 'plan.pdf' }],
        permanent: true,
      })
    }
    expect(deleteOfficeShelfDocumentRow).toHaveBeenCalledWith('d1', 'org-1')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'office_shelf.document.deleted' }),
    )
  })

  it('purges the chunks again once the row is gone, and a failure there is not surfaced', async () => {
    const doc = makeDocument({
      id: 'd1',
      scope: 'office_shelf',
      projectId: null,
      collectionName: 'archiv_org-1',
      storageKey: 'org/org-1/archiv/doc/d1/plan.pdf',
    })
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    vi.mocked(findOfficeShelfDocument).mockResolvedValue(doc)
    const order: string[] = []
    let purges = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        order.push('purge')
        purges += 1
        if (purges === 2) throw new Error('backend down')
        return { ok: true }
      }),
    )
    vi.mocked(eraseDocumentObjectsOrKeepRow).mockImplementationOnce(async () => {
      order.push('objects')
      return { versionsLeft: 0 }
    })
    vi.mocked(deleteOfficeShelfDocumentRow).mockImplementationOnce(async () => {
      order.push('row')
    })

    await deleteOfficeShelfDocument(session, 'd1', request)

    expect(order).toEqual(['purge', 'objects', 'row', 'purge'])
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'office_shelf.document.deleted',
        metadata: expect.objectContaining({ chunksPurged: true }),
      }),
    )
  })

  it('refuses a held document with a 409 before erasing anything', async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    vi.mocked(findOfficeShelfDocument).mockResolvedValue(
      makeDocument({
        id: 'd1',
        scope: 'office_shelf',
        projectId: null,
        collectionName: 'archiv_org-1',
        storageKey: 'org/org-1/archiv/doc/d1/plan.pdf',
      }),
    )
    vi.mocked(isCoveredByActiveHold).mockResolvedValueOnce(true)
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)
    vi.mocked(s3Client.send).mockClear()

    const error = await deleteOfficeShelfDocument(session, 'd1', request).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toEqual({ reason: 'legal_hold', entityType: 'document' })
    expect(isCoveredByActiveHold).toHaveBeenCalledWith('org-1', 'document', 'd1')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(eraseDocumentObjectsOrKeepRow).not.toHaveBeenCalled()
    expect(deleteOfficeShelfDocumentRow).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'office_shelf.document.deleted' }),
    )
  })

  it('erases every stored object through the shared cleanup, and keeps the row when it fails', async () => {
    const doc = makeDocument({
      id: 'd1',
      scope: 'office_shelf',
      projectId: null,
      collectionName: 'archiv_org-1',
      storageKey: 'org/org-1/archiv/doc/d1/plan.pdf',
    })
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    vi.mocked(findOfficeShelfDocument).mockResolvedValue(doc)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
    vi.mocked(eraseDocumentObjectsOrKeepRow).mockRejectedValueOnce(new UpstreamError('nope'))

    await expect(deleteOfficeShelfDocument(session, 'd1', request)).rejects.toBeInstanceOf(UpstreamError)

    expect(eraseDocumentObjectsOrKeepRow).toHaveBeenCalledWith(doc, 'org-1')
    expect(deleteOfficeShelfDocumentRow).not.toHaveBeenCalled()
  })

  it('purges no chunks for a machine-authored row, and still deletes it', async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    vi.mocked(findOfficeShelfDocument).mockResolvedValue(
      makeDocument({
        id: 'd1',
        scope: 'office_shelf',
        projectId: null,
        authoredBy: 'agent',
        collectionName: 'archiv_org-1',
        storageKey: 'org/org-1/archiv/doc/d1/plan.pdf',
      }),
    )
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    await deleteOfficeShelfDocument(session, 'd1', request)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(deleteOfficeShelfDocumentRow).toHaveBeenCalledWith('d1', 'org-1')
  })

  it('replaces an Archiv document of the same name instead of ghosting it', async () => {
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(makeLiveDocumentMatch({
      id: 'archiv-doc-1',
      storageKey: 'org/org-1/archiv/archiv-doc-1/norm.pdf',
      storageBucket: 'test-bucket',
      fileSize: 500,
      contentHash: null,
      folderId: null,
      status: 'ready',
    }))

    vi.mocked(canManageOfficeShelf).mockReturnValue(true)

    const result = await uploadOfficeShelfDocument(session, makeFile('norm.pdf'), request)

    expect(result.documentId).toBe('archiv-doc-1')
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(admitReplacementOrDiscard).toHaveBeenCalled()
  })

  it('files a re-upload whose document was just deleted as a first upload', async () => {
    vi.mocked(findLiveDocumentByFilename)
      .mockResolvedValueOnce(makeLiveDocumentMatch({
        id: 'archiv-deleted',
        storageKey: 'org/org-1/archiv/doc/archiv-deleted/norm.pdf',
        storageBucket: 'test-bucket',
        fileSize: 500,
        contentHash: null,
        folderId: null,
        status: 'ready',
      }))
      .mockResolvedValueOnce(null)
    vi.mocked(admitReplacementOrDiscard).mockRejectedValueOnce(
      new ReplacedDocumentGoneError('archiv-deleted'),
    )
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)

    const result = await uploadOfficeShelfDocument(session, makeFile('norm.pdf'), request)

    const inserted = vi.mocked(admitOrDiscard).mock.calls.at(-1)
    expect(inserted?.[2]).toMatchObject({ scope: 'office_shelf', filename: 'norm.pdf' })
    expect(result.documentId).not.toBe('archiv-deleted')
    expect(result.documentId).toBe(inserted?.[2].id)
  })

  it('answers 409 and dispatches nothing when the document is deleted before its version is recorded', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValueOnce(null)
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)

    await expect(uploadOfficeShelfDocument(session, makeFile('norm.pdf'), request)).rejects.toMatchObject({
      status: 409,
      details: { reason: 'deleted_during_upload' },
    })
    expect(dispatchDocument).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('makes the loser of two concurrent first uploads a new version of the winner', async () => {
    const winner = makeLiveDocumentMatch({
      id: 'archiv-winner',
      storageKey: 'org/org-1/archiv/doc/archiv-winner/norm.pdf',
      storageBucket: 'test-bucket',
      fileSize: 500,
      contentHash: null,
      folderId: null,
      status: 'uploaded',
    })
    vi.mocked(findLiveDocumentByFilename).mockResolvedValueOnce(null).mockResolvedValueOnce(winner)
    vi.mocked(admitOrDiscard).mockRejectedValueOnce(new LiveFilenameTakenError('norm.pdf'))
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)

    const result = await uploadOfficeShelfDocument(session, makeFile('norm.pdf'), request)

    expect(result.documentId).toBe('archiv-winner')
    const replaced = vi.mocked(admitReplacementOrDiscard).mock.calls.at(-1)
    expect(replaced?.[3]).toBe('archiv-winner')
    expect(replaced?.[1]).toMatch(/\/doc\/archiv-winner\/v\d+\/[0-9a-f]{12}\/norm\.pdf$/)
  })
})

describe('probeOfficeShelfDocumentNames and a quarantined file', () => {
  it("keeps a member to their own, and a curator to every one", async () => {
    vi.mocked(canManageOfficeShelf).mockReturnValue(false)
    await probeOfficeShelfDocumentNames(session, ['Honorar.pdf'])
    expect(findOfficeShelfDocumentsByNames).toHaveBeenLastCalledWith('org-1', ['Honorar.pdf'], { reader: { kind: 'member', userId: 'user-1' } })

    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    await probeOfficeShelfDocumentNames(session, ['Honorar.pdf'])
    expect(vi.mocked(findOfficeShelfDocumentsByNames).mock.lastCall?.[2]).toEqual({ reader: { kind: 'reviewer' } })
  })
})
