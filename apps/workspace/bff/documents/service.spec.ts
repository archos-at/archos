import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { refreshSearchRows } from '@/lib/search/refresh-rows'

vi.mock('@/lib/office-shelf/service', () => ({ deleteOfficeShelfDocument: vi.fn() }))
vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('@/lib/download-log/service', () => ({ recordDocumentAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/search/refresh-rows', () => ({ refreshSearchRows: vi.fn(async () => undefined) }))
vi.mock('./version-repository', () => ({
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

vi.mock('@/lib/storage/upload-limit', () => ({
  assertFileSizeAllowed: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: vi.fn(),
}))

vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn().mockResolvedValue(undefined) },
  signingS3Client: { send: vi.fn().mockResolvedValue(undefined) },
  bucketAdminS3Client: { send: vi.fn().mockResolvedValue(undefined) },
  bucketName: 'test-bucket',
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://seaweedfs.internal/presigned'),
}))

vi.mock('@/lib/backend-proxy', () => ({
  getBackendUrl: vi.fn().mockReturnValue('http://backend:8000'),
}))

vi.mock('@/lib/audit/service', () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/organizations/service', () => ({
  getOrgSettings: vi.fn().mockResolvedValue({ displayName: null, defaultLocale: 'de', settings: {} }),
}))

vi.mock('@/lib/upload-screening/project-repository', () => ({
  findProjectScreeningOverride: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/documents/vlm-capability', () => ({
  isVlmConfigured: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/lib/storage/admission', () => ({
  admitOrDiscard: vi.fn().mockResolvedValue(undefined),
  admitReplacementOrDiscard: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/base-knowledge/text-guard', () => ({
  isTextHeld: vi.fn(async () => false),
  copyMarkForIngest: vi.fn(async () => null),
}))
vi.mock('./repository', () => ({
  setDocumentIngestJob: vi.fn().mockResolvedValue(undefined),
  markDocumentIngestFailed: vi.fn().mockResolvedValue(undefined),
  findFolderPathInProject: vi.fn().mockResolvedValue(null),
  findFolderPathInOfficeShelf: vi.fn().mockResolvedValue(null),
  findDocumentInOrg: vi.fn(),
  findLiveDocumentByFilename: vi.fn().mockResolvedValue(null),
  findProjectCollectionsHoldingFilename: vi.fn().mockResolvedValue([]),
  listProjectDocuments: vi.fn(),
  listProjectDocumentPage: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
  listDocumentLevelPage: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
  findProjectDocumentsByFilenames: vi.fn().mockResolvedValue([]),
  findProjectDocumentsByNames: vi.fn().mockResolvedValue([]),
  deleteProjectDocument: vi.fn().mockResolvedValue(undefined),
  setDocumentDisplayName: vi.fn().mockResolvedValue(undefined),
  setDocumentReconciledStatus: vi.fn().mockResolvedValue(true),
  listFailedDocumentPageInOrg: vi.fn().mockResolvedValue({ ids: [], nextCursor: null }),
}))

vi.mock('@/lib/jobs-queue/enqueue', () => ({
  enqueueJob: vi.fn().mockResolvedValue({ jobId: 'job-1' }),
}))
vi.mock('@/lib/jobs-queue/repository', () => ({
  findOpenJobId: vi.fn().mockResolvedValue(null),
}))

vi.mock('./revision-links-loader', () => ({ loadRevisionLinks: vi.fn(async () => new Map()) }))
vi.mock('@/lib/annotations/repository', () => ({ tallyLiveMarks: vi.fn(async () => new Map()) }))
vi.mock('./reconcile-status', async (importOriginal) => ({
  extractIngestJobId: (await importOriginal<typeof import('./reconcile-status')>()).extractIngestJobId,
  reconcileDocumentStatuses: vi.fn(),
  describeBackendIngestState: vi.fn(),
}))

vi.mock('@/lib/upload-batches/settle', () => ({ onDocumentsSettled: vi.fn().mockResolvedValue(undefined) }))

vi.mock('@/lib/documents/object-cleanup', () => ({
  eraseDocumentObjectsOrKeepRow: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/compliance/repository', () => ({
  isCoveredByActiveHold: vi.fn().mockResolvedValue(false),
}))

import { findProjectInOrg } from '@/lib/projects/repository'
import { loadRevisionLinks } from './revision-links-loader'
import { onDocumentsSettled } from '@/lib/upload-batches/settle'
import { isCoveredByActiveHold } from '@/lib/compliance/repository'
import { eraseDocumentObjectsOrKeepRow } from '@/lib/documents/object-cleanup'
import { requireProjectAccess } from '@/lib/authz/projects'
import { recordAuditEvent } from '@/lib/audit/service'
import { enqueueJob } from '@/lib/jobs-queue/enqueue'
import { findOpenJobId } from '@/lib/jobs-queue/repository'
import { emptyCounts, type ReindexProjectPayload, type ReingestFailedPayload } from '@/lib/jobs-queue/types'
import { admitOrDiscard, admitReplacementOrDiscard } from '@/lib/storage/admission'
import {
  setDocumentIngestJob,
  markDocumentIngestFailed,
  findDocumentInOrg,
  findLiveDocumentByFilename,
  findFolderPathInProject,
  findFolderPathInOfficeShelf,
  listProjectDocumentPage,
  listDocumentLevelPage,
  findProjectDocumentsByFilenames,
  findProjectDocumentsByNames,
  findProjectCollectionsHoldingFilename,
  deleteProjectDocument,
  setDocumentDisplayName,
  setDocumentReconciledStatus,
  listFailedDocumentPageInOrg,
} from './repository'
import {
  DOCUMENT_WRITE_PERMISSIONS,
  getHiddenFolderIds,
  getProjectFolderAccess,
  requireFolderWrite,
  type ProjectFolderAccess,
} from '@/lib/authz/folder-access'
import { getDocumentTextPreview, getDocumentThumbnail, getDocumentDownload, getDocumentPreview, streamDocumentFile, streamDocumentImage } from './document-delivery'
import { getDocumentStatus, getDocumentVisualDetails } from './document-details'
import { uploadDocument, dispatchDocument, AgentAuthoredDocumentNotIndexableError } from './document-dispatch'
import { deleteDocument, renameDocument, updateDocumentTags } from './document-edits'
import { listDocumentsPage, probeProjectDocumentNames, resolveProjectDocumentsByName } from './document-listing'
import { INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'
import { reingestFailedOrgDocuments, runReingestFailedSlice, REINGEST_SLICE_DOCUMENTS } from './ingest-recovery'
import { reindexProject, runReindexSlice, REINDEX_SLICE_DOCUMENTS } from './reindex'
import { reingestDocument } from './reingest'
import { fetchGroupedSemanticHits, joinHitsToFiles } from './semantic-search'
import { deleteOfficeShelfDocument } from '@/lib/office-shelf/service'
import { encodeDocumentLevelCursor } from './list-cursor'
import {
  reconcileDocumentStatuses,
  describeBackendIngestState,
  type DocumentMetadata,
} from './reconcile-status'
import type { DocumentListRow } from './repository'
import {
  insertPublishedVersion,
  listDocumentVersionSummaries,
  nextVersionNumber,
} from './version-repository'
import { LiveFilenameTakenError, ReplacedDocumentGoneError } from './unique-conflicts'
import { isVlmConfigured } from '@/lib/documents/vlm-capability'
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, UpstreamError } from '@/lib/api/errors'
import { makeDocument, makeLiveDocumentMatch, makeProject } from '@/test-utils/db-fixtures'
import { mayReadDocument } from './document-reader'
import { INGEST_ALREADY_DONE, INGEST_NOT_ELIGIBLE, INGEST_RUNNING } from './reingest-codes'
import { DOCUMENT_TYPE_TAGS } from './tag-vocabulary'
import { s3Client, bucketAdminS3Client } from '@/lib/s3'
import { __resetBucketCache, tenantBucketName } from '@/lib/storage/bucket'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import type { AuthorizedSession } from '@/lib/auth/types'
import { buildDocumentImageUrl } from '@/lib/images/signed-image-url'
import { recordDocumentAccess } from '@/lib/download-log/service'
import { NAME_TAKEN_REASON } from '@/lib/documents/name-taken'

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

const sliceState = (overrides: Partial<ReindexProjectPayload> = {}): ReindexProjectPayload => ({
  projectId: 'proj-1',
  requester: {
    userId: session.userId,
    email: session.email,
    organizationMembershipId: session.organizationMembershipId,
    role: session.role,
    permissions: session.permissions,
  },
  cursor: null,
  counts: emptyCounts(),
  ...overrides,
})

const makeInput = (overrides: { name?: string; type?: string } = {}) => ({
  projectId: 'proj-1',
  folderId: null,
  file: {
    name: overrides.name ?? 'plan.pdf',
    type: overrides.type ?? 'application/pdf',
    size: 1234,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
  } as unknown as File,
})

const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    vi.stubGlobal('crypto', { ...globalThis.crypto, randomUUID: () => 'doc-uuid' })
  }
  mockFetch.mockReset()
  vi.mocked(findProjectInOrg).mockResolvedValue(makeProject())
  vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument())
  vi.mocked(requireFolderWrite).mockImplementation(async (s, projectId) => {
    await requireProjectAccess(s, projectId, DOCUMENT_WRITE_PERMISSIONS)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('dispatchDocument reads the row, and needs one', () => {
  it('refuses a document whose row it cannot read', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(null)

    await expect(
      dispatchDocument({
        organizationId: 'org-1',
        projectId: 'proj-1',
        documentId: 'doc-vanished',
        filename: 'plan.pdf',
        storageKey: 'k',
        storageBucket: 'b',
        collectionName: 'proj_abc',
      })
    ).rejects.toBeInstanceOf(AgentAuthoredDocumentNotIndexableError)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})

describe('uploadDocument server-side type gate', () => {
  it('rejects an image with a 400 when the image-upload flag is off (capability on)', async () => {
    vi.mocked(isVlmConfigured).mockResolvedValue(true)
    vi.stubEnv('REQUIRE_AUTH', 'true')
    const gatedSession = { ...session, featureFlags: [] }

    await expect(
      uploadDocument(
        gatedSession,
        makeInput({ name: 'photo.png', type: 'image/png' }),
        new Request('http://x')
      )
    ).rejects.toBeInstanceOf(BadRequestError)

    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('rejects an image when the capability is absent/unconfirmed even with the flag on (fail-closed)', async () => {
    vi.mocked(isVlmConfigured).mockResolvedValue(false)
    vi.stubEnv('FILE_UPLOAD_ACCEPTED_TYPES', '.pdf,.docx,.txt,.md,.png,.jpg,.jpeg')
    vi.stubEnv('REQUIRE_AUTH', 'true')
    const gatedSession = { ...session, featureFlags: ['image-upload'] }

    await expect(
      uploadDocument(
        gatedSession,
        makeInput({ name: 'photo.png', type: 'image/png' }),
        new Request('http://x')
      )
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('accepts an image when the flag is on AND the VLM capability is confirmed', async () => {
    vi.mocked(isVlmConfigured).mockResolvedValue(true)
    vi.stubEnv('REQUIRE_AUTH', 'true')
    const gatedSession = { ...session, featureFlags: ['image-upload'] }
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-img' }),
    })

    const result = await uploadDocument(
      gatedSession,
      makeInput({ name: 'photo.png', type: 'image/png' }),
      new Request('http://x')
    )

    expect(result.status).toBe('pending')
    expect(admitOrDiscard).toHaveBeenCalled()
  })

  it('rejects a type outside the accepted list regardless of flags (general allow-list)', async () => {
    await expect(
      uploadDocument(
        session,
        makeInput({ name: 'malware.exe', type: 'application/octet-stream' }),
        new Request('http://x')
      )
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })
})

describe('uploadDocument server-side name screening', () => {
  it('refuses a file whose name matches the policy, before anything is stored', async () => {
    await expect(
      uploadDocument(session, makeInput({ name: 'Schlussrechnung 2026.pdf' }), new Request('http://x'))
    ).rejects.toMatchObject({ status: 422, code: 'UPLOAD_SCREENED' })
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses a file because of the folder it sat in, and names the folder', async () => {
    const error = await uploadDocument(
      session,
      { ...makeInput({ name: 'scan_0042.pdf' }), originPath: 'Akt/Personalunterlagen/scan_0042.pdf' },
      new Request('http://x')
    ).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      details: { matches: [{ term: 'Personal', segment: 'Personalunterlagen', kind: 'folder' }] },
    })
  })

  it('screens a folder past the stored label’s cut, which the label alone would let through', async () => {
    const deep = Array.from({ length: 100 }, (_, index) => `Ordner${String(index).padStart(4, '0')}`).join('/')
    expect(deep.length).toBeGreaterThan(1024)
    const error = await uploadDocument(
      session,
      { ...makeInput({ name: 'scan_0042.pdf' }), originPath: `${deep}/Personalunterlagen/scan_0042.pdf` },
      new Request('http://x')
    ).catch((caught: unknown) => caught)
    expect(error).toMatchObject({
      code: 'UPLOAD_SCREENED',
      details: { matches: [{ term: 'Personal', segment: 'Personalunterlagen', kind: 'folder' }] },
    })
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('stores a matching file the uploader released, and audits the override', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ job_id: 'job-1' }) })
    const result = await uploadDocument(
      session,
      { ...makeInput({ name: 'Architektenvertrag.pdf' }), screeningRelease: true },
      new Request('http://x')
    )
    expect(result.status).toBe('pending')
    expect(admitOrDiscard).toHaveBeenCalled()
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.screening_overridden',
        metadata: expect.objectContaining({ terms: 'Vertrag' }),
      })
    )
  })

  it('lets an ordinary plan through without an override event', async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ job_id: 'job-1' }) })
    await uploadDocument(session, makeInput({ name: 'Statische Berechnung.pdf' }), new Request('http://x'))
    expect(admitOrDiscard).toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.screening_overridden' })
    )
  })
})

describe('uploadDocument refuses an IFC model into a restricted folder', () => {
  const restricted = (): ProjectFolderAccess => ({
    hiddenFolderIds: new Set<string>(),
    isVisible: () => true,
    collectionFor: (folderId) => (folderId === 'f-restricted' ? 'proj_abc_r0123456789ab' : 'proj_abc'),
    clearedRestrictedCollections: ['proj_abc_r0123456789ab'],
    levelOf: () => 'write',
    sourceFolderOf: () => null,
    anyRestricted: true,
  })

  it('answers 409 with the reason, and stores nothing', async () => {
    vi.mocked(getProjectFolderAccess).mockResolvedValueOnce(restricted())
    const error = await uploadDocument(
      session,
      { ...makeInput({ name: 'Haus-A.ifc', type: 'application/octet-stream' }), folderId: 'f-restricted' },
      new Request('http://x')
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(ConflictError)
    expect(error).toMatchObject({
      status: 409,
      message: expect.stringContaining('IFC models cannot be filed in a restricted folder yet'),
      details: { code: 'IFC_IN_RESTRICTED_FOLDER' },
    })
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses an .ifczip the same way', async () => {
    vi.mocked(getProjectFolderAccess).mockResolvedValueOnce(restricted())
    await expect(
      uploadDocument(
        session,
        { ...makeInput({ name: 'Haus-A.IFCZIP', type: 'application/zip' }), folderId: 'f-restricted' },
        new Request('http://x')
      )
    ).rejects.toMatchObject({ status: 409 })
  })

  it('still files any other document into the restricted folder', async () => {
    vi.mocked(getProjectFolderAccess).mockResolvedValueOnce(restricted())
    vi.mocked(findFolderPathInProject).mockResolvedValueOnce('Leitung')
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ job_id: 'job-1' }) })
    const result = await uploadDocument(
      session,
      { ...makeInput({ name: 'Bauzeitplan.pdf' }), folderId: 'f-restricted' },
      new Request('http://x')
    )
    expect(result.status).toBe('pending')
    expect(admitOrDiscard).toHaveBeenCalled()
  })
})

describe('uploadDocument bucket selection', () => {
  beforeEach(() => {
    __resetBucketCache()
    vi.mocked(bucketAdminS3Client.send).mockResolvedValue(undefined as never)
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('writes to the shared bucket and records it when the feature is off', async () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'false')
    await uploadDocument(session, makeInput(), new Request('http://x'))

    const put = vi.mocked(s3Client.send).mock.calls.at(-1)![0] as unknown as {
      input: { Bucket: string }
    }
    expect(put.input.Bucket).toBe('test-bucket')
    expect(admitOrDiscard).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ storageBucket: 'test-bucket' })
    )
    expect(bucketAdminS3Client.send).not.toHaveBeenCalled()
  })

  it('provisions and writes to the organization bucket when the feature is on', async () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'true')
    await uploadDocument(session, makeInput(), new Request('http://x'))

    const expected = tenantBucketName('org-1')
    expect(vi.mocked(bucketAdminS3Client.send)).toHaveBeenCalled()
    const put = vi.mocked(s3Client.send).mock.calls.at(-1)![0] as unknown as {
      input: { Bucket: string }
    }
    expect(put.input.Bucket).toBe(expected)
    expect(admitOrDiscard).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ storageBucket: expected })
    )
  })

  it('presigns the ingest download and the thumbnail slot against that same bucket', async () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'true')
    vi.mocked(getSignedUrl).mockClear()
    await uploadDocument(session, makeInput(), new Request('http://x'))

    const expected = tenantBucketName('org-1')
    const buckets = vi
      .mocked(getSignedUrl)
      .mock.calls.map((call) => (call[1] as unknown as { input: { Bucket: string } }).input.Bucket)
    expect(buckets.length).toBeGreaterThanOrEqual(2)
    expect(new Set(buckets)).toEqual(new Set([expected]))
  })
})

describe('uploadDocument ingest dispatch', () => {
  it('success path: uploaded -> pending with the backend job id', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-42' }),
    })

    const result = await uploadDocument(session, makeInput(), new Request('http://x'))

    expect(result.status).toBe('pending')
    expect(result.jobId).toBe('job-42')
    expect(setDocumentIngestJob).toHaveBeenCalledWith(result.documentId, 'org-1', 'job-42', null, expect.objectContaining({ ingestJobId: null }))
    expect(markDocumentIngestFailed).not.toHaveBeenCalled()
    expect(admitOrDiscard).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ status: 'uploaded' as const })
    )
  })

  it('dispatch throws: persists status failed + errorMessage', async () => {
    mockFetch.mockRejectedValue(new Error('network down'))

    const result = await uploadDocument(session, makeInput(), new Request('http://x'))

    expect(result.status).toBe('failed')
    expect(result.jobId).toBeNull()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      result.documentId,
      'org-1',
      INGEST_DISPATCH_FAILED_MESSAGE,
      expect.objectContaining({ ingestJobId: null })
    )
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('dispatch non-OK: persists status failed + errorMessage', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    })

    const result = await uploadDocument(session, makeInput(), new Request('http://x'))

    expect(result.status).toBe('failed')
    expect(result.jobId).toBeNull()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      result.documentId,
      'org-1',
      INGEST_DISPATCH_FAILED_MESSAGE,
      expect.objectContaining({ ingestJobId: null })
    )
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('dispatch OK without a job id: persists failed, never a green birth status', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    })

    const result = await uploadDocument(session, makeInput(), new Request('http://x'))

    expect(result.status).toBe('failed')
    expect(result.jobId).toBeNull()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      result.documentId,
      'org-1',
      INGEST_DISPATCH_FAILED_MESSAGE,
      expect.objectContaining({ ingestJobId: null })
    )
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })
})

describe('uploadDocument filed as a new Fassung (ADR-0099)', () => {
  const OLDER_ID = '0b8f3c1e-0d3a-4d2e-9a53-6d1f9d6c2b11'
  const older = (overrides: Parameters<typeof makeDocument>[0] = {}) =>
    makeDocument({
      id: OLDER_ID,
      filename: 'Grundriss_EG_Index_B.pdf',
      contentHash: 'h',
      screeningOutcome: 'clean',
      ...overrides,
    })
  const ingestBody = (): Record<string, unknown> => {
    const call = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/v1/ingest'))
    expect(call).toBeDefined()
    return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>
  }
  const putCalls = () => vi.mocked(s3Client.send).mock.calls.filter(([command]) => command instanceof PutObjectCommand)

  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ job_id: 'job-7' }) })
  })

  it('checks the older document, sends its file name to the ingest job, and records the choice', async () => {
    vi.mocked(findDocumentInOrg).mockImplementation(async (id) =>
      id === OLDER_ID ? older() : makeDocument({ id, filename: 'Grundriss_EG_Index_C.pdf' }),
    )

    await uploadDocument(
      session,
      { ...makeInput({ name: 'Grundriss_EG_Index_C.pdf' }), revisionOf: OLDER_ID },
      new Request('http://x'),
    )

    expect(ingestBody().revision_of).toBe('Grundriss_EG_Index_B.pdf')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.uploaded', metadata: expect.objectContaining({ revisionOf: OLDER_ID }) }),
    )
  })

  it.each([
    ['archived', { lifecycle: 'archived' as const }, 'archived'],
    ['in another collection', { collectionName: 'proj_abc_r_folder1' }, 'different_collection'],
  ])('stores the file as a document of its own when the older document is %s, and reports why it is not linked', async (_label, overrides, reason) => {
    vi.mocked(findDocumentInOrg).mockImplementation(async (id) =>
      id === OLDER_ID ? older(overrides) : makeDocument({ id, filename: 'Grundriss_EG_Index_C.pdf' }),
    )
    vi.mocked(s3Client.send).mockClear()

    const result = await uploadDocument(
      session,
      { ...makeInput({ name: 'Grundriss_EG_Index_C.pdf' }), revisionOf: OLDER_ID },
      new Request('http://x'),
    )

    expect(putCalls()).toHaveLength(1)
    expect(result).toMatchObject({ revisionOfIgnored: reason })
    expect(ingestBody()).not.toHaveProperty('revision_of')
    const metadata = vi.mocked(recordAuditEvent).mock.calls.find(([event]) => event.action === 'document.uploaded')?.[0].metadata
    expect(metadata).toMatchObject({ revisionOfIgnored: reason })
    expect(metadata).not.toHaveProperty('revisionOf')
  })

  it('sends no revision_of, and records none, for an upload nobody filed as a Fassung', async () => {
    await uploadDocument(session, makeInput({ name: 'Grundriss_EG_Index_C.pdf' }), new Request('http://x'))

    expect(ingestBody()).not.toHaveProperty('revision_of')
    expect(vi.mocked(recordAuditEvent).mock.calls.at(-1)?.[0].metadata).not.toHaveProperty('revisionOf')
  })
})

describe('uploadDocument with a chosen document type', () => {
  const ingestBody = (): Record<string, unknown> => {
    const call = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/v1/ingest'))
    expect(call).toBeDefined()
    return JSON.parse(String((call![1] as RequestInit).body)) as Record<string, unknown>
  }

  beforeEach(() => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ job_id: 'job-8' }) })
  })

  it('sends the chosen type to the ingest job', async () => {
    await uploadDocument(
      session,
      { ...makeInput({ name: 'letter.pdf' }), documentType: DOCUMENT_TYPE_TAGS[7] },
      new Request('http://x'),
    )

    expect(ingestBody().document_type).toBe(DOCUMENT_TYPE_TAGS[7])
  })

  it('sends no document_type for an upload that chose none', async () => {
    await uploadDocument(session, makeInput({ name: 'letter.pdf' }), new Request('http://x'))

    expect(ingestBody()).not.toHaveProperty('document_type')
  })
})

describe('uploadDocument ingest dispatch — backend fetch is time-bounded', () => {
  it('sends the ingest dispatch with an AbortSignal so a hung backend cannot stall the request', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-42' }),
    })

    await uploadDocument(session, makeInput(), new Request('http://x'))

    const ingestCall = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/v1/ingest'))
    expect(ingestCall).toBeDefined()
    expect((ingestCall?.[1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    expect((ingestCall?.[1] as RequestInit).headers).toMatchObject({
      'x-organization-id': 'org-1',
    })
  })

  it('a timeout abort fails open exactly like a network error (persists failed, no crash)', async () => {
    mockFetch.mockRejectedValue(new DOMException('The operation timed out.', 'TimeoutError'))

    const result = await uploadDocument(session, makeInput(), new Request('http://x'))

    expect(result.status).toBe('failed')
    expect(result.jobId).toBeNull()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      result.documentId,
      'org-1',
      INGEST_DISPATCH_FAILED_MESSAGE,
      expect.objectContaining({ ingestJobId: null })
    )
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })
})

describe('listDocumentsPage', () => {
  const LEVEL = { folderId: undefined, sort: 'added', dir: 'desc', limit: 100 } as const

  it.each([
    [{ authoredBy: 'agent' as const }, { authoredBy: 'agent', includeArchived: undefined }],
    [{}, { authoredBy: undefined, includeArchived: undefined }],
    [{ includeArchived: true }, { includeArchived: true }],
  ])('hands the filters %o down to the query', async (filters, expected) => {
    vi.mocked(listDocumentLevelPage).mockResolvedValue({ rows: [], nextCursor: null })
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])
    await listDocumentsPage(session, 'proj-1', { ...filters, level: LEVEL })
    expect(listDocumentLevelPage).toHaveBeenCalledWith(
      { kind: 'project', projectId: 'proj-1' },
      session.organizationId,
      expect.objectContaining(expected)
    )
  })

  it('reads one page behind the project gate and encodes the level cursor', async () => {
    const next = { sort: 'name', dir: 'asc', value: 'plan.pdf', id: '00000000-0000-4000-8000-000000000002' } as const
    vi.mocked(listDocumentLevelPage).mockResolvedValueOnce({ rows: [], nextCursor: next })
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])
    const level = { folderId: null, sort: 'name', dir: 'asc', limit: 100 } as const

    const page = await listDocumentsPage(session, 'proj-1', { level })

    expect(requireProjectAccess).toHaveBeenCalledWith(session, 'proj-1', 'project:view')
    expect(listDocumentLevelPage).toHaveBeenCalledWith(
      { kind: 'project', projectId: 'proj-1' },
      session.organizationId,
      expect.objectContaining({ level, includeArchived: undefined })
    )
    expect(page.nextCursor).toBe(encodeDocumentLevelCursor(next))
  })

  it('carries the curated metadata subset through and strips the internal metadata column', async () => {
    vi.mocked(listDocumentLevelPage).mockResolvedValue({ rows: [], nextCursor: null })
    const reconciled: Array<DocumentListRow & DocumentMetadata> = [
      {
        id: 'doc-1',
        filename: 'plan.pdf',
        projectId: 'proj-1',
        scope: 'project',
        displayName: null,
        lifecycle: 'active',
        publishedVersionId: null,
        originPath: null,
        contentHash: null,
        createdBy: 'user-1',
        screeningOutcome: null,
        screenedHash: null,
        fileSize: 1024,
        contentType: 'application/pdf',
        status: 'completed' as const,
        authoredBy: 'user',
        collectionName: 'proj_abc',
        folderId: null,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        updatedAt: new Date('2026-01-02T00:00:00Z'),
        errorMessage: null,
        metadata: { ingestJobId: 'job-1' },
        summary: 'A ground-floor plan.',
        pageCount: 4,
        chunkCount: 12,
        contentTypes: ['text', 'table'],
        tags: ['Grundriss', 'Brandschutz'],
      },
    ]
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue(reconciled)

    const [row] = (await listDocumentsPage(session, 'proj-1', { level: LEVEL })).documents

    expect(row).not.toHaveProperty('metadata')
    expect(row.summary).toBe('A ground-floor plan.')
    expect(row.pageCount).toBe(4)
    expect(row.chunkCount).toBe(12)
    expect(row.contentTypes).toEqual(['text', 'table'])
    expect(row.tags).toEqual(['Grundriss', 'Brandschutz'])
  })
})


describe('probeProjectDocumentNames', () => {
  it('asks the listing gate, then the database, for the dropped names', async () => {
    const match = {
      id: 'doc-1',
      filename: 'EG.pdf',
      displayName: null,
      fileSize: 1,
      contentHash: null,
      status: 'completed',
      folderId: null,
      authoredBy: 'user' as const,
      lifecycle: 'archived' as const,
    }
    vi.mocked(findProjectDocumentsByNames).mockResolvedValueOnce([match])

    expect(await probeProjectDocumentNames(session, 'proj-1', ['EG.pdf'])).toEqual([match])
    expect(requireProjectAccess).toHaveBeenCalledWith(session, 'proj-1', 'project:view')
    expect(findProjectDocumentsByNames).toHaveBeenCalledWith('proj-1', session.organizationId, ['EG.pdf'], {
      hiddenFolderIds: [],
      reader: { kind: 'reviewer' },
    })
  })

  it('reads nothing for a reader without the project', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new Error('forbidden'))
    await expect(probeProjectDocumentNames(session, 'proj-1', ['EG.pdf'])).rejects.toThrow('forbidden')
    expect(findProjectDocumentsByNames).not.toHaveBeenCalled()
  })
})

describe('joinHitsToFiles', () => {
  const older = {
    filename: 'plan.pdf',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    id: 'old',
    authoredBy: 'user',
    collectionName: 'c',
  }
  const newer = {
    filename: 'plan.pdf',
    createdAt: new Date('2026-02-01T00:00:00Z'),
    id: 'new',
    authoredBy: 'user',
    collectionName: 'c',
  }
  const other = {
    filename: 'permit.pdf',
    createdAt: new Date('2026-01-05T00:00:00Z'),
    id: 'permit',
    authoredBy: 'user',
    collectionName: 'c',
  }

  it('joins by filename and augments each row with snippet/page/score', () => {
    const hits = [
      {
        file_name: 'permit.pdf',
        score: 0.42,
        snippet: 'permit text',
        page_number: 3,
        collection: 'c',
      },
    ]
    const [row] = joinHitsToFiles(hits, [older, other])
    expect(row).toMatchObject({ id: 'permit', snippet: 'permit text', page: 3, score: 0.42 })
  })

  it('preserves hit order (backend guarantees score-descending)', () => {
    const hits = [
      { file_name: 'permit.pdf', score: 0.9, snippet: 'b', page_number: null, collection: 'c' },
      { file_name: 'plan.pdf', score: 0.5, snippet: 'a', page_number: 1, collection: 'c' },
    ]
    const result = joinHitsToFiles(hits, [older, other])
    expect(result.map((r) => r.id)).toEqual(['permit', 'old'])
  })

  it('drops hits whose filename is not among the file rows', () => {
    const hits = [
      { file_name: 'ghost.pdf', score: 0.8, snippet: 'x', page_number: null, collection: 'c' },
    ]
    expect(joinHitsToFiles(hits, [older, other])).toEqual([])
  })

  it('resolves a filename collision to the most-recent row', () => {
    const hits = [
      { file_name: 'plan.pdf', score: 0.7, snippet: 'x', page_number: null, collection: 'c' },
    ]
    const [row] = joinHitsToFiles(hits, [older, newer])
    expect(row.id).toBe('new')
  })

  it('coerces a missing page_number to null', () => {
    const hits = [
      { file_name: 'plan.pdf', score: 0.3, snippet: 'x', page_number: null, collection: 'c' },
    ]
    const [row] = joinHitsToFiles(hits, [older])
    expect(row.page).toBeNull()
  })

  it('never returns a machine-authored row, even on an exact filename match', () => {
    const generated = {
      filename: 'plan.pdf',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      id: 'generated',
      authoredBy: 'agent',
      collectionName: 'c',
    }
    const hits = [
      { file_name: 'plan.pdf', score: 0.7, snippet: 'x', page_number: 2, collection: 'c' },
    ]
    expect(joinHitsToFiles(hits, [generated])).toEqual([])
  })

  it('lets the user row win a collision a newer machine-authored row would take', () => {
    const userRow = { ...older, authoredBy: 'user' }
    const generated = {
      filename: 'plan.pdf',
      createdAt: new Date('2026-03-01T00:00:00Z'),
      id: 'generated',
      authoredBy: 'agent',
      collectionName: 'c',
    }
    const hits = [
      { file_name: 'plan.pdf', score: 0.7, snippet: 'x', page_number: null, collection: 'c' },
    ]
    const [row] = joinHitsToFiles(hits, [userRow, generated])
    expect(row.id).toBe('old')
  })

  it('admits only `user`, so an author value nobody has added yet stays out', () => {
    const unknownAuthor = {
      filename: 'plan.pdf',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      id: 'imported',
      authoredBy: 'import',
      collectionName: 'c',
    }
    const hits = [
      { file_name: 'plan.pdf', score: 0.7, snippet: 'x', page_number: null, collection: 'c' },
    ]
    expect(joinHitsToFiles(hits, [unknownAuthor])).toEqual([])
  })

  it('takes the authorship of each row, not of the first one seen', () => {
    const generated = {
      filename: 'permit.pdf',
      createdAt: new Date('2026-06-01T00:00:00Z'),
      id: 'generated',
      authoredBy: 'agent',
      collectionName: 'c',
    }
    const hits = [
      { file_name: 'plan.pdf', score: 0.9, snippet: 'a', page_number: null, collection: 'c' },
      { file_name: 'permit.pdf', score: 0.4, snippet: 'x', page_number: null, collection: 'c' },
    ]
    expect(joinHitsToFiles(hits, [older, generated]).map((r) => r.id)).toEqual(['old'])
  })

  describe('the collection is part of the identity', () => {
    const open = {
      filename: 'Protokoll.pdf',
      createdAt: new Date('2026-09-01T00:00:00Z'),
      id: 'open-root',
      authoredBy: 'user',
      collectionName: 'proj_abc',
    }
    const restricted = {
      filename: 'Protokoll.pdf',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      id: 'gf-intern',
      authoredBy: 'user',
      collectionName: 'proj_abc_rabcdef012345',
    }
    const hitIn = (collection: string, score = 0.8) => ({
      file_name: 'Protokoll.pdf',
      score,
      snippet: `aus ${collection}`,
      page_number: 1,
      collection,
    })

    it('does not hand a restricted hit to a newer same-named row of another collection', () => {
      const result = joinHitsToFiles([hitIn('proj_abc_rabcdef012345')], [restricted, open])
      expect(result.map((r) => r.id)).toEqual(['gf-intern'])
      expect(result[0].collectionName).toBe('proj_abc_rabcdef012345')
    })

    it('drops a hit whose own collection has no row, rather than falling back to the name', () => {
      expect(joinHitsToFiles([hitIn('proj_abc_rabcdef012345')], [open])).toEqual([])
    })

    it('joins the open hit to the open row when the restricted row is the newer one', () => {
      const newerRestricted = { ...restricted, createdAt: new Date('2026-10-01T00:00:00Z') }
      expect(joinHitsToFiles([hitIn('proj_abc')], [open, newerRestricted]).map((r) => r.id)).toEqual(['open-root'])
    })

    it('gives two hits on one name in two collections two rows, each its own', () => {
      const result = joinHitsToFiles([hitIn('proj_abc', 0.9), hitIn('proj_abc_rabcdef012345', 0.5)], [open, restricted])
      expect(result.map((r) => [r.id, r.snippet])).toEqual([
        ['open-root', 'aus proj_abc'],
        ['gf-intern', 'aus proj_abc_rabcdef012345'],
      ])
    })

    it('still resolves a collision inside one collection to the most-recent row', () => {
      const reuploaded = { ...open, id: 'open-older', createdAt: new Date('2026-02-01T00:00:00Z') }
      expect(joinHitsToFiles([hitIn('proj_abc')], [reuploaded, open]).map((r) => r.id)).toEqual(['open-root'])
    })
  })
})

describe('fetchGroupedSemanticHits (one ranking across collections, ADR-0116)', () => {
  const ok = (hits: unknown[]) => new Response(JSON.stringify({ hits }), { status: 200 })
  const backendHit = (collection: string, fileName: string, score: number) => ({
    file_name: fileName,
    collection,
    score,
    snippet: 's',
    page_number: 1,
  })

  it('asks once for every collection, signed for exactly those, and numbers the ranking it gets back', async () => {
    mockFetch.mockResolvedValueOnce(ok([backendHit('proj_b', 'b.pdf', 0.4), backendHit('proj_a', 'a.pdf', 0.9)]))

    const hits = await fetchGroupedSemanticHits('org-1', ['proj_a', 'proj_b', 'proj_a'], 'Fluchttreppe', 3, 900)

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [url, init] = mockFetch.mock.calls[0]
    expect(String(url)).toMatch(/\/v1\/collections\/search$/)
    expect(JSON.parse(init.body)).toMatchObject({
      query: 'Fluchttreppe',
      collections: ['proj_a', 'proj_b'],
      groups: 2,
      files_per_group: 3,
      snippet_max_chars: 900,
    })
    expect(hits?.map((hit) => [hit.collection, hit.rank])).toEqual([
      ['proj_b', 0],
      ['proj_a', 1],
    ])
  })

  it('drops a hit from a collection it did not ask for', async () => {
    mockFetch.mockResolvedValueOnce(ok([backendHit('proj_other', 'x.pdf', 0.9), backendHit('proj_a', 'a.pdf', 0.5)]))
    const hits = await fetchGroupedSemanticHits('org-1', ['proj_a'], 'q', 3)
    expect(hits?.map((hit) => hit.collection)).toEqual(['proj_a'])
  })

  it('throws an upstream error, never "nothing found", when the backend refuses, fails or answers garbage', async () => {
    mockFetch.mockResolvedValueOnce(new Response('{"detail":"grouped document search failed"}', { status: 500 }))
    await expect(fetchGroupedSemanticHits('org-1', ['proj_a'], 'q', 3)).rejects.toBeInstanceOf(UpstreamError)
    mockFetch.mockRejectedValueOnce(new Error('down'))
    await expect(fetchGroupedSemanticHits('org-1', ['proj_a'], 'q', 3)).rejects.toBeInstanceOf(UpstreamError)
    mockFetch.mockResolvedValueOnce(new Response('{"nothits":1}', { status: 200 }))
    await expect(fetchGroupedSemanticHits('org-1', ['proj_a'], 'q', 3)).rejects.toBeInstanceOf(UpstreamError)
  })

  it('sends the pre-filters and the boost in the one request, and nothing when there are none', async () => {
    const boost = { facts: { federal_state: 'vienna', building_class: [4], construction_method: [], uses: [], work_type: [] }, weights: { federal_state: 4 } }
    mockFetch.mockResolvedValueOnce(ok([]))
    await fetchGroupedSemanticHits('org-1', ['proj_a'], 'q', 10, 900, { filters: { document_types: ['Bescheid'] }, boost })
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toMatchObject({ filters: { document_types: ['Bescheid'] }, boost })

    mockFetch.mockResolvedValueOnce(ok([]))
    await fetchGroupedSemanticHits('org-1', ['proj_a'], 'q', 10)
    const plain = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect('filters' in plain || 'boost' in plain).toBe(false)
  })
})

describe('resolveProjectDocumentsByName', () => {
  it('gates on project:view, looks the names up directly, and hydrates like the listing', async () => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    const row = {
      id: 'doc-old',
      filename: 'Bestand-1962.pdf',
      createdAt: new Date('2019-01-01T00:00:00Z'),
      status: 'completed' as const,
      collectionName: 'proj_abc',
      errorMessage: null,
      authoredBy: 'user',
      publishedVersionId: null,
    }
    vi.mocked(findProjectDocumentsByFilenames).mockResolvedValue([row] as never)
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([{ ...row, metadata: { ingestJobId: 'j' } }] as never)

    const documents = await resolveProjectDocumentsByName(session, 'proj-1', ['bestand-1962.pdf'])

    expect(requireProjectAccess).toHaveBeenCalledWith(session, 'proj-1', 'project:view')
    expect(findProjectDocumentsByFilenames).toHaveBeenCalledWith('proj-1', 'org-1', ['bestand-1962.pdf'], {
      hiddenFolderIds: [],
      reader: { kind: 'reviewer' },
    })
    expect(listProjectDocumentPage).not.toHaveBeenCalled()
    expect(documents).toEqual([expect.objectContaining({ id: 'doc-old', assignees: [] })])
    expect(documents[0]).not.toHaveProperty('metadata')
  })

  it('reads nothing for a caller without access', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new ForbiddenError())
    await expect(resolveProjectDocumentsByName(session, 'proj-1', ['a.pdf'])).rejects.toBeInstanceOf(ForbiddenError)
    expect(findProjectDocumentsByFilenames).not.toHaveBeenCalled()
  })
})

describe('reingestDocument', () => {
  const failedDoc = makeDocument({
    id: 'doc-99',
    status: 'failed' as const,
    storageKey: 'org/proj/doc/file.pdf',
  })

  it('happy path: failed -> pending with a fresh job id', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(failedDoc)
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-77' }),
    })

    const result = await reingestDocument(session, 'doc-99')

    expect(result).toEqual({ id: 'doc-99', status: 'pending' as const, jobId: 'job-77' })
    expect(setDocumentIngestJob).toHaveBeenCalledWith('doc-99', 'org-1', 'job-77', null, expect.objectContaining({ ingestJobId: null }))
    expect(markDocumentIngestFailed).not.toHaveBeenCalled()
  })

  it('presigns against the bucket the document is actually in', async () => {
    vi.stubEnv('SEAWEED_PER_ORG_BUCKETS', 'true')
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-99',
        status: 'failed' as const,
        storageKey: 'org/org-1/project/proj-1/doc/doc-99/plan.pdf',
        storageBucket: 'grid-org-org-1-deadbeef1234',
      })
    )
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({}) })
    vi.mocked(getSignedUrl).mockClear()

    await reingestDocument(session, 'doc-99')

    const buckets = vi
      .mocked(getSignedUrl)
      .mock.calls.map((call) => (call[1] as unknown as { input: { Bucket: string } }).input.Bucket)
    expect(buckets.length).toBeGreaterThanOrEqual(2)
    expect(new Set(buckets)).toEqual(new Set(['grid-org-org-1-deadbeef1234']))
    vi.unstubAllEnvs()
  })

  it('re-reads an indexed document a person uploaded, through the same dispatch', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...failedDoc, status: 'completed' as const })
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-80' }),
    })

    const result = await reingestDocument(session, 'doc-99')

    expect(result).toEqual({ id: 'doc-99', status: 'pending' as const, jobId: 'job-80' })
    expect(describeBackendIngestState).not.toHaveBeenCalled()
    const methods = mockFetch.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method)
    expect(methods).not.toContain('DELETE')
    expect(String(mockFetch.mock.calls[0]?.[0])).toContain('/v1/ingest')
  })

  it('refuses to re-read an indexed agent-authored document (409 INGEST_NOT_ELIGIBLE)', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-99',
        status: 'completed' as const,
        storageKey: 'org/proj/doc/file.pdf',
        authoredBy: 'agent',
        authoredByProducer: 'deep_research',
        authoredByRef: 'run-7',
        authoredByRefKind: 'agent_run',
      })
    )

    await expect(reingestDocument(session, 'doc-99')).rejects.toMatchObject({
      status: 409,
      details: { code: INGEST_NOT_ELIGIBLE },
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('refuses a row re-ingest does not apply to (409 INGEST_NOT_ELIGIBLE)', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...failedDoc, status: 'stored' as const })

    await expect(reingestDocument(session, 'doc-99')).rejects.toMatchObject({
      status: 409,
      details: { status: 'stored' as const, code: INGEST_NOT_ELIGIBLE },
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('retries a stuck processing row the backend has lost, keeping the id', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-99', status: 'processing' as const, storageKey: 'org/proj/doc/file.pdf' })
    )
    vi.mocked(describeBackendIngestState).mockResolvedValue({ state: 'absent' })
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-78' }),
    })

    const result = await reingestDocument(session, 'doc-99')

    expect(result).toEqual({ id: 'doc-99', status: 'pending' as const, jobId: 'job-78' })
    expect(setDocumentIngestJob).toHaveBeenCalledWith('doc-99', 'org-1', 'job-78', null, expect.objectContaining({ ingestJobId: null }))
  })

  it('refuses while the backend is genuinely still working (409, no double dispatch)', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-99', status: 'processing' as const, storageKey: 'org/proj/doc/file.pdf' })
    )
    vi.mocked(describeBackendIngestState).mockResolvedValue({ state: 'in-progress' })

    await expect(reingestDocument(session, 'doc-99')).rejects.toBeInstanceOf(ConflictError)
    await expect(reingestDocument(session, 'doc-99')).rejects.toMatchObject({
      details: { status: 'processing' as const, code: INGEST_RUNNING },
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('heals the row instead of retrying when the backend already finished', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-99',
        status: 'processing' as const,
        storageKey: 'org/proj/doc/file.pdf',
        metadata: { ingestJobId: 'job-80' },
      })
    )
    vi.mocked(describeBackendIngestState).mockResolvedValue({
      state: 'terminal',
      resolution: { status: 'completed' as const, errorMessage: null },
    })

    await expect(reingestDocument(session, 'doc-99')).rejects.toMatchObject({
      status: 409,
      details: { status: 'completed' as const, code: INGEST_ALREADY_DONE },
    })
    expect(setDocumentReconciledStatus).toHaveBeenCalledWith(
      'doc-99',
      'org-1',
      { status: 'completed' as const, errorMessage: null },
      { status: 'processing' as const, jobId: 'job-80' }
    )
    expect(mockFetch).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('settles a row the retry finds quarantined, so the quarantine is audited and its reviewers told', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-99', status: 'processing' as const, storageKey: 'org/proj/doc/file.pdf' })
    )
    const verdict = 'quarantined:{"reasons":[{"kind":"iban"}],"checked":"full"}'
    vi.mocked(describeBackendIngestState).mockResolvedValue({
      state: 'terminal',
      resolution: { status: 'quarantined' as const, errorMessage: verdict, screeningOutcome: 'quarantined' },
    })

    await expect(reingestDocument(session, 'doc-99')).rejects.toMatchObject({
      details: { status: 'quarantined' as const, code: INGEST_ALREADY_DONE },
    })
    expect(onDocumentsSettled).toHaveBeenCalledWith('org-1', [{ id: 'doc-99', status: 'quarantined' as const }])
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('leaves the settling to the listing read that moved the row first', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-99', status: 'processing' as const, storageKey: 'org/proj/doc/file.pdf' })
    )
    vi.mocked(describeBackendIngestState).mockResolvedValue({
      state: 'terminal',
      resolution: { status: 'quarantined' as const, errorMessage: 'quarantined:{}', screeningOutcome: 'quarantined' },
    })
    vi.mocked(setDocumentReconciledStatus).mockResolvedValueOnce(false)

    await expect(reingestDocument(session, 'doc-99')).rejects.toMatchObject({
      details: { status: 'quarantined' as const, code: INGEST_ALREADY_DONE },
    })
    expect(onDocumentsSettled).not.toHaveBeenCalled()
  })

  it('heals a row the backend already failed, then retries it', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-99', status: 'processing' as const, storageKey: 'org/proj/doc/file.pdf' })
    )
    vi.mocked(describeBackendIngestState).mockResolvedValue({
      state: 'terminal',
      resolution: { status: 'failed' as const, errorMessage: 'boom' },
    })
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-81' }),
    })

    const result = await reingestDocument(session, 'doc-99')

    expect(setDocumentReconciledStatus).toHaveBeenCalledWith(
      'doc-99',
      'org-1',
      { status: 'failed' as const, errorMessage: 'boom' },
      { status: 'processing' as const, jobId: null }
    )
    expect(result).toEqual({ id: 'doc-99', status: 'pending' as const, jobId: 'job-81' })
    expect(onDocumentsSettled).not.toHaveBeenCalled()
  })

  it('refuses when the backend cannot be asked (fail-closed, row untouched)', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-99', status: 'processing' as const, storageKey: 'org/proj/doc/file.pdf' })
    )
    vi.mocked(describeBackendIngestState).mockResolvedValue({ state: 'unreachable' })

    await expect(reingestDocument(session, 'doc-99')).rejects.toBeInstanceOf(UpstreamError)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
    expect(markDocumentIngestFailed).not.toHaveBeenCalled()
  })

  it('retries a row stranded at the uploaded birth status without asking the backend', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-99', status: 'uploaded' as const, storageKey: 'org/proj/doc/file.pdf' })
    )
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-79' }),
    })

    const result = await reingestDocument(session, 'doc-99')

    expect(result).toEqual({ id: 'doc-99', status: 'pending' as const, jobId: 'job-79' })
    expect(describeBackendIngestState).not.toHaveBeenCalled()
  })

  it('dispatch failure re-marks the document failed', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(failedDoc)
    mockFetch.mockRejectedValue(new Error('network down'))

    const result = await reingestDocument(session, 'doc-99')

    expect(result.status).toBe('failed')
    expect(result.jobId).toBeNull()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith(
      'doc-99',
      'org-1',
      INGEST_DISPATCH_FAILED_MESSAGE,
      expect.objectContaining({ ingestJobId: null })
    )
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })
})

describe('the folder a document is filed in reaches the ingest dispatch', () => {
  const ingestBody = (): Record<string, unknown> => {
    const call = mockFetch.mock.calls.find(([url]) => String(url).endsWith('/v1/ingest'))
    if (!call) throw new Error('no /v1/ingest call was made')
    return JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>
  }

  beforeEach(() => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ job_id: 'job-1' }),
    })
  })

  it('sends the folder path an upload was filed into', async () => {
    vi.mocked(findFolderPathInProject).mockResolvedValue('Brandschutz/Fluchtwege')

    await uploadDocument(session, { ...makeInput(), folderId: 'folder-1' }, new Request('http://x'))

    expect(ingestBody().folder_path).toBe('Brandschutz/Fluchtwege')
  })

  it('sends the project’s facts and status, so the new chunks are filtered and lifted like their siblings', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ projectId: 'proj-1' }))
    vi.mocked(findProjectInOrg).mockResolvedValue(
      makeProject({
        id: 'proj-1',
        status: 'closed',
        profile: {
          facts: {
            federal_state: { value: 'vienna', source: 'user_confirmed' },
            construction_method: { value: ['timber'], source: 'user_confirmed' },
          },
          goals: {},
          unknowns: [],
          assumptions: {},
        } as unknown as ReturnType<typeof makeProject>['profile'],
      })
    )

    await uploadDocument(session, makeInput(), new Request('http://x'))

    expect(ingestBody().project_facts).toEqual({
      facts: { federal_state: 'vienna', building_class: [], construction_method: ['timber'], uses: [], work_type: [] },
      status: 'closed',
    })
  })

  it('sends null for an upload at the project root', async () => {
    vi.mocked(findFolderPathInProject).mockResolvedValue(null)

    await uploadDocument(session, makeInput(), new Request('http://x'))

    expect(ingestBody().folder_path).toBeNull()
  })

  it('re-supplies the folder path when a failed document is re-ingested', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-99',
        status: 'failed' as const,
        storageKey: 'org/org-1/project/proj-1/doc/doc-99/plan.pdf',
        projectId: 'proj-1',
        folderId: 'folder-1',
      })
    )
    vi.mocked(findFolderPathInProject).mockResolvedValue('Brandschutz')

    await reingestDocument(session, 'doc-99')

    expect(ingestBody().folder_path).toBe('Brandschutz')
  })

  it('re-supplies an ARCHIV document\u2019s folder path on re-ingest', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-99',
        status: 'failed' as const,
        storageKey: 'org/org-1/archiv/doc/doc-99/norm.pdf',
        projectId: null,
        scope: 'office_shelf',
        collectionName: 'archiv_org-1',
        folderId: 'folder-1',
      })
    )
    vi.mocked(findFolderPathInOfficeShelf).mockResolvedValue('Normen/Brandschutz')

    await reingestDocument({ ...session, role: 'admin', permissions: ['org:office_shelf:manage'] }, 'doc-99')

    expect(findFolderPathInOfficeShelf).toHaveBeenCalledWith('folder-1', 'org-1')
    expect(findFolderPathInProject).not.toHaveBeenCalled()
    expect(ingestBody().folder_path).toBe('Normen/Brandschutz')
  })

  it('sends null on re-ingest for a document that was never filed', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-99',
        status: 'failed' as const,
        storageKey: 'org/org-1/project/proj-1/doc/doc-99/plan.pdf',
        projectId: 'proj-1',
        folderId: null,
      })
    )

    await reingestDocument(session, 'doc-99')

    expect(ingestBody().folder_path).toBeNull()
    expect(findFolderPathInProject).not.toHaveBeenCalled()
  })
})

describe('deleteDocument', () => {
  const projectDoc = makeDocument()

  it('404s when the document is not in the org', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(null)

    await expect(
      deleteDocument(session, 'missing', new Request('http://x'))
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(deleteProjectDocument).not.toHaveBeenCalled()
  })

  it('hands an office shelf document to the office shelf delete, never through project access', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({
      ...projectDoc,
      projectId: null,
      scope: 'office_shelf',
    })
    const request = new Request('http://x')

    await deleteDocument(session, 'doc-1', request)

    expect(deleteOfficeShelfDocument).toHaveBeenCalledWith(session, 'doc-1', request)
    expect(requireProjectAccess).not.toHaveBeenCalled()
    expect(deleteProjectDocument).not.toHaveBeenCalled()
  })

  it('rejects callers without project:edit (403) before any side effects', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new ForbiddenError())

    await expect(deleteDocument(session, 'doc-1', new Request('http://x'))).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(deleteProjectDocument).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses a delete in a folder the session may only read (ADR-0088), before any side effects', async () => {
    const { folderReadOnlyError } = await import('@/lib/authz/folder-access-rule')
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...projectDoc, folderId: 'folder-read-only' })
    vi.mocked(requireFolderWrite).mockRejectedValueOnce(folderReadOnlyError())

    const error = await deleteDocument(session, 'doc-1', new Request('http://x')).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ForbiddenError)
    expect((error as ForbiddenError).details).toEqual({ reason: 'folder-read-only' })
    expect(requireFolderWrite).toHaveBeenCalledWith(session, 'proj-1', ['folder-read-only'])
    expect(isCoveredByActiveHold).not.toHaveBeenCalled()
    expect(deleteProjectDocument).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('refuses a held document with a 409 before erasing anything', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(isCoveredByActiveHold).mockResolvedValueOnce(true)
    vi.mocked(s3Client.send).mockClear()
    mockFetch.mockClear()

    const error = await deleteDocument(session, 'doc-1', new Request('http://x')).catch(
      (e: unknown) => e
    )

    expect(error).toBeInstanceOf(ConflictError)
    expect((error as ConflictError).details).toEqual({ reason: 'legal_hold', entityType: 'document' })
    expect(isCoveredByActiveHold).toHaveBeenCalledWith('org-1', 'document', 'doc-1')
    expect(mockFetch).not.toHaveBeenCalled()
    expect(s3Client.send).not.toHaveBeenCalled()
    expect(eraseDocumentObjectsOrKeepRow).not.toHaveBeenCalled()
    expect(deleteProjectDocument).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('asks about the hold only after the access check', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new NotFoundError())

    await expect(deleteDocument(session, 'doc-1', new Request('http://x'))).rejects.toBeInstanceOf(
      NotFoundError
    )
    expect(isCoveredByActiveHold).not.toHaveBeenCalled()
  })

  it('purges chunks, deletes the object + row, and audits', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockResolvedValue({ ok: true })

    await deleteDocument(session, 'doc-1', new Request('http://x'))

    expect(requireProjectAccess).toHaveBeenCalledWith(session, 'proj-1', [
      'project:documents:write',
      'project:edit',
    ])
    const purgeCall = mockFetch.mock.calls.find(
      ([url, init]) =>
        String(url).endsWith('/documents') && (init as RequestInit)?.method === 'DELETE'
    )
    expect(purgeCall?.[0]).toBe('http://backend:8000/v1/collections/proj_abc/documents')
    expect(deleteProjectDocument).toHaveBeenCalledWith('doc-1', 'org-1', 'proj-1')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.deleted', organizationId: 'org-1' })
    )
  })

  it('erases every stored object (each version, _thumb, _img/, _bim/) before the row', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockResolvedValue({ ok: true })
    const order: string[] = []
    vi.mocked(eraseDocumentObjectsOrKeepRow).mockImplementationOnce(async () => {
      order.push('objects')
      return { versionsLeft: 0 }
    })
    vi.mocked(deleteProjectDocument).mockImplementationOnce(async () => {
      order.push('row')
    })

    await deleteDocument(session, 'doc-1', new Request('http://x'))

    expect(eraseDocumentObjectsOrKeepRow).toHaveBeenCalledWith(projectDoc, 'org-1')
    expect(order).toEqual(['objects', 'row'])
  })

  it('keeps the row, and audits nothing, when the objects could not be erased', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockResolvedValue({ ok: true })
    vi.mocked(eraseDocumentObjectsOrKeepRow).mockRejectedValueOnce(new UpstreamError('nope'))

    await expect(deleteDocument(session, 'doc-1', new Request('http://x'))).rejects.toBeInstanceOf(
      UpstreamError
    )
    expect(deleteProjectDocument).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('still deletes the row + audits when the best-effort chunk purge fails', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockRejectedValue(new Error('backend down'))

    await deleteDocument(session, 'doc-1', new Request('http://x'))

    expect(deleteProjectDocument).toHaveBeenCalledWith('doc-1', 'org-1', 'proj-1')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.deleted' })
    )
  })

  it('purges the chunks again once the row is gone', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    const order: string[] = []
    mockFetch.mockImplementation(async (url: unknown, init?: RequestInit) => {
      if (String(url).endsWith('/documents') && init?.method === 'DELETE') order.push('purge')
      return { ok: true }
    })
    vi.mocked(eraseDocumentObjectsOrKeepRow).mockImplementationOnce(async () => {
      order.push('objects')
      return { versionsLeft: 0 }
    })
    vi.mocked(deleteProjectDocument).mockImplementationOnce(async () => {
      order.push('row')
    })

    await deleteDocument(session, 'doc-1', new Request('http://x'))

    expect(order).toEqual(['purge', 'objects', 'row', 'purge'])
  })

  it('audits and answers normally when only the purge after the row fails', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('backend down'))

    await deleteDocument(session, 'doc-1', new Request('http://x'))

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.deleted',
        filedIn: { projectId: projectDoc.projectId, folderId: projectDoc.folderId },
        metadata: expect.objectContaining({ chunksPurged: true }),
      })
    )
  })

  it('does not purge after a row it kept', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockClear()
    mockFetch.mockResolvedValue({ ok: true })
    vi.mocked(eraseDocumentObjectsOrKeepRow).mockRejectedValueOnce(new UpstreamError('nope'))

    await expect(deleteDocument(session, 'doc-1', new Request('http://x'))).rejects.toBeInstanceOf(
      UpstreamError
    )
    const purges = mockFetch.mock.calls.filter(
      ([url, init]) =>
        String(url).endsWith('/documents') && (init as RequestInit)?.method === 'DELETE'
    )
    expect(purges).toHaveLength(1)
  })
})

describe('renameDocument', () => {
  const projectDoc = makeDocument()
  const request = () => new Request('http://x')

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })
  })

  it('stores the trimmed name and mirrors it to the backend metadata row', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)

    const result = await renameDocument(session, 'doc-1', '  Einreichplan.pdf  ', request())

    expect(result).toEqual({ id: 'doc-1', filename: 'plan.pdf', displayName: 'Einreichplan.pdf' })
    expect(setDocumentDisplayName).toHaveBeenCalledWith('doc-1', 'org-1', 'Einreichplan.pdf')

    const [url, init] = mockFetch.mock.calls.at(-1) ?? []
    expect(String(url)).toBe(
      'http://backend:8000/v1/collections/proj_abc/documents/plan.pdf/display-title'
    )
    expect((init as RequestInit)?.method).toBe('PATCH')
    expect(JSON.parse(String((init as RequestInit)?.body))).toEqual({
      display_title: 'Einreichplan.pdf',
    })
  })

  it('never touches the file name — the join key to the object and the chunks', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)

    await renameDocument(session, 'doc-1', 'Einreichplan.pdf', request())

    expect(setDocumentDisplayName).toHaveBeenCalledTimes(1)
    expect(deleteProjectDocument).not.toHaveBeenCalled()
  })

  it('treats a rename back to the file name as a clear, not a stored duplicate', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({
      ...projectDoc,
      displayName: 'Einreichplan.pdf',
    })

    const result = await renameDocument(session, 'doc-1', 'plan.pdf', request())

    expect(result.displayName).toBeNull()
    expect(setDocumentDisplayName).toHaveBeenCalledWith('doc-1', 'org-1', null)
  })

  it('clears the rename on null', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({
      ...projectDoc,
      displayName: 'Einreichplan.pdf',
    })

    await renameDocument(session, 'doc-1', null, request())

    expect(setDocumentDisplayName).toHaveBeenCalledWith('doc-1', 'org-1', null)
    expect(JSON.parse(String((mockFetch.mock.calls.at(-1) ?? [])[1]?.body))).toEqual({
      display_title: null,
    })
  })

  it('refuses an unusable name (400) before writing anything', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)

    await expect(
      renameDocument(session, 'doc-1', 'plans/EG.pdf', request())
    ).rejects.toBeInstanceOf(BadRequestError)
    expect(setDocumentDisplayName).not.toHaveBeenCalled()
    expect(recordAuditEvent).not.toHaveBeenCalled()
  })

  it('404s when the document is not in the org', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(null)

    await expect(renameDocument(session, 'missing', 'x.pdf', request())).rejects.toBeInstanceOf(
      NotFoundError
    )
    expect(setDocumentDisplayName).not.toHaveBeenCalled()
  })

  it('rejects a caller without write access (403) before any side effect', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(requireProjectAccess).mockRejectedValueOnce(new ForbiddenError())

    await expect(renameDocument(session, 'doc-1', 'x.pdf', request())).rejects.toBeInstanceOf(
      ForbiddenError
    )
    expect(setDocumentDisplayName).not.toHaveBeenCalled()
  })

  it('keeps the rename when the backend mirror fails — the row is the durable one', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    mockFetch.mockRejectedValue(new Error('backend down'))

    const result = await renameDocument(session, 'doc-1', 'Einreichplan.pdf', request())

    expect(result.displayName).toBe('Einreichplan.pdf')
    expect(setDocumentDisplayName).toHaveBeenCalledWith('doc-1', 'org-1', 'Einreichplan.pdf')
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document.renamed' })
    )
  })

  it('records both names in the audit trail, under the scope-correct action', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...projectDoc, displayName: 'Alt.pdf' })

    await renameDocument(session, 'doc-1', 'Neu.pdf', request())

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document.renamed',
        targetType: 'document',
        targetId: 'doc-1',
        filedIn: { projectId: projectDoc.projectId, folderId: projectDoc.folderId },
        metadata: expect.objectContaining({
          filename: 'plan.pdf',
          previousName: 'Alt.pdf',
          displayName: 'Neu.pdf',
        }),
      })
    )
  })

  it('renames an Archiv document too, under the Archiv action', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({
      ...projectDoc,
      projectId: null,
      scope: 'office_shelf',
      collectionName: 'archiv_org-1',
    })

    await expect(
      renameDocument({ ...session, role: 'admin', permissions: ['org:office_shelf:manage'] }, 'doc-1', 'Musterordner.pdf', request())
    ).resolves.toMatchObject({ displayName: 'Musterordner.pdf' })
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'office_shelf.document.renamed', filedIn: null })
    )
  })
})

describe('getDocumentStatus', () => {
  const projectDoc = makeDocument({ displayName: 'Aufsicht 1:100' })

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findDocumentInOrg).mockResolvedValue(projectDoc)
    vi.mocked(reconcileDocumentStatuses).mockImplementation(
      async (rows) => rows.map((row) => ({ ...row })) as never
    )
  })

  it('projects the identity, the label and the shelf', async () => {
    await expect(getDocumentStatus(session, 'doc-1')).resolves.toMatchObject({
      id: projectDoc.id,
      filename: projectDoc.filename,
      displayName: 'Aufsicht 1:100',
      scope: 'project',
    })
  })

  it('carries the Fassung facts resolved for the reader, and null when there are none', async () => {
    await expect(getDocumentStatus(session, 'doc-1')).resolves.toHaveProperty('revision', null)

    const facts = { supersededBy: { id: 'doc-2', filename: 'b.pdf' }, supersedes: [], suggestion: null, changeSummary: null }
    vi.mocked(loadRevisionLinks).mockResolvedValueOnce(new Map([[projectDoc.id, facts]]))

    await expect(getDocumentStatus(session, 'doc-1')).resolves.toHaveProperty('revision', facts)
  })

  it('carries the shelf for a document that is not on the project shelf', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({
      ...projectDoc,
      projectId: null,
      scope: 'office_shelf',
      collectionName: 'archiv_org-1',
    })

    await expect(getDocumentStatus(session, 'doc-1')).resolves.toMatchObject({ scope: 'office_shelf' })
  })

  it('carries why a held document is held, as the stored verdict says', async () => {
    await expect(getDocumentStatus(session, 'doc-1')).resolves.toHaveProperty('quarantine', null)

    vi.mocked(findDocumentInOrg).mockResolvedValue({
      ...projectDoc,
      status: 'quarantined',
      screeningOutcome: 'quarantined',
      createdBy: session.userId,
      quarantine: { reasons: [{ kind: 'passport', count: 1, pages: [4] }], checked: 'full', omitted: 2 },
    })

    await expect(getDocumentStatus(session, 'doc-1')).resolves.toHaveProperty('quarantine', {
      reasons: [{ kind: 'other', count: 1, pages: [4] }],
      checked: 'full',
      omitted: 2,
    })
  })

  it('reports a null displayName rather than omitting the key', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue({ ...projectDoc, displayName: null })

    const status = await getDocumentStatus(session, 'doc-1')

    expect(status).toHaveProperty('displayName', null)
  })

  it('carries the version count from the document_versions summary', async () => {
    vi.mocked(listDocumentVersionSummaries).mockResolvedValueOnce([
      { documentId: projectDoc.id, versionCount: 2, state: 'published' },
    ])

    const status = await getDocumentStatus(session, 'doc-1')

    expect(status).toHaveProperty('versionCount', 2)
    expect(listDocumentVersionSummaries).toHaveBeenCalledWith([projectDoc.id], session.organizationId)
  })

  describe('when the reconcile quarantines the file', () => {
    const reread = makeDocument({ status: 'pending' as const, screeningOutcome: 'clean', createdBy: 'someone-else' })

    beforeEach(() => {
      vi.mocked(requireProjectAccess).mockImplementation(async (_session, _projectId, permission) => {
        if (permission === 'project:manage') throw new NotFoundError('Project not found')
        return { role: 'project-viewer', closed: false, readsBecauseClosed: false }
      })
      vi.mocked(findDocumentInOrg).mockImplementation(async (_id, _org, reader) =>
        mayReadDocument(reread, reader) ? reread : null
      )
      vi.mocked(reconcileDocumentStatuses).mockImplementation(
        async (rows) => rows.map((row) => ({ ...row, status: 'quarantined' as const, screeningOutcome: 'quarantined' })) as never
      )
    })

    it('answers 404 to a member who did not upload it', async () => {
      await expect(getDocumentStatus(session, 'doc-1')).rejects.toBeInstanceOf(NotFoundError)
    })

    it('still answers its uploader', async () => {
      await expect(getDocumentStatus({ ...session, userId: 'someone-else' }, 'doc-1')).resolves.toMatchObject({
        status: 'quarantined' as const,
      })
    })
  })

  it('reports a null versionCount when the document has no version row', async () => {
    vi.mocked(listDocumentVersionSummaries).mockResolvedValueOnce([])

    const status = await getDocumentStatus(session, 'doc-1')

    expect(status).toHaveProperty('versionCount', null)
  })
})

describe('the authorship gate on the (collection, filename) join', () => {
  const collidingName = 'brandschutz-gutachten-2026-08-20.pdf'

  const humanDoc = makeDocument({ filename: collidingName })

  const agentDoc = makeDocument({
    id: 'doc-agent',
    filename: collidingName,
    authoredBy: 'agent',
    authoredByProducer: 'deep_research',
    authoredByRef: 'run-7',
    authoredByRefKind: 'agent_run',
    status: 'stored' as const,
    storageKey: 'org/org-1/project/proj-1/doc/doc-agent/' + collidingName,
  })

  const documentCalls = () =>
    mockFetch.mock.calls.filter(([url]) => String(url).includes('/v1/collections/'))

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
  })

  describe('deleteDocument', () => {
    it("does not purge chunks for a machine-authored row — they are somebody else's", async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentDoc)

      await deleteDocument(session, 'doc-agent', new Request('http://x'))

      expect(documentCalls()).toHaveLength(0)
      expect(deleteProjectDocument).toHaveBeenCalledWith('doc-agent', 'org-1', 'proj-1')
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'document.deleted' })
      )
    })

    it('still purges chunks for the human document that owns the same filename', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)

      await deleteDocument(session, 'doc-1', new Request('http://x'))

      const [url, init] = documentCalls()[0] ?? []
      expect(String(url)).toBe('http://backend:8000/v1/collections/proj_abc/documents')
      expect((init as RequestInit)?.method).toBe('DELETE')
      expect(JSON.parse(String((init as RequestInit)?.body))).toEqual({
        file_ids: [collidingName],
        documents: [{ id: 'doc-1', file_name: collidingName }],
        permanent: true,
      })
    })

    it('purges permanently, both times: a deleted document keeps no Fassung link for a later upload of its name', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)

      await deleteDocument(session, 'doc-1', new Request('http://x'))

      const deletes = documentCalls().filter(([, init]) => (init as RequestInit)?.method === 'DELETE')
      expect(deletes).toHaveLength(2)
      for (const [, init] of deletes) {
        expect(JSON.parse(String((init as RequestInit)?.body))).toMatchObject({ permanent: true })
      }
    })
  })

  describe('getDocumentVisualDetails', () => {
    beforeEach(() => {
      vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
    })
    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('returns no page text for a machine-authored row, and asks for none', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentDoc)

      await expect(getDocumentVisualDetails(session, 'doc-agent')).resolves.toEqual({
        id: 'doc-agent',
        details: [],
      })
      expect(documentCalls()).toHaveLength(0)
    })

    it('still fetches page text for the human document with the same filename', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          details: [{ page: 3, content_type: 'drawing', text: 'Schnitt A-A' }],
        }),
      })

      const result = await getDocumentVisualDetails(session, 'doc-1')

      expect(result.details).toEqual([
        {
          page: 3,
          contentType: 'drawing',
          drawingType: '',
          scale: '',
          text: 'Schnitt A-A',
          segment: 0,
          segmentCount: 1,
          structured: null,
        },
      ])
      expect(String(documentCalls()[0]?.[0])).toBe(
        `http://backend:8000/v1/collections/proj_abc/documents/${collidingName}/visual-details`
      )
    })
  })

  describe('updateDocumentTags', () => {
    it('404s a machine-authored row instead of retagging the colliding document', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentDoc)

      await expect(updateDocumentTags(session, 'doc-agent', ['Gutachten'])).rejects.toBeInstanceOf(
        NotFoundError
      )
      expect(documentCalls()).toHaveLength(0)
    })

    it('still retags the human document with the same filename', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ tags: ['Gutachten'] }),
      })

      await expect(updateDocumentTags(session, 'doc-1', ['Gutachten'])).resolves.toEqual({
        id: 'doc-1',
        tags: ['Gutachten'],
      })
      expect(String(documentCalls()[0]?.[0])).toBe(
        `http://backend:8000/v1/collections/proj_abc/documents/${collidingName}/tags`
      )
    })

    it('forwards topics in the PATCH body only when given, and returns what the backend answered', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ tags: ['Gutachten'], topics: ['Fluchtweg'] }),
      })

      await expect(updateDocumentTags(session, 'doc-1', ['Gutachten'], ['Fluchtweg'])).resolves.toEqual({
        id: 'doc-1',
        tags: ['Gutachten'],
        topics: ['Fluchtweg'],
      })
      const init = documentCalls()[0]?.[1] as RequestInit
      expect(JSON.parse(String(init.body))).toEqual({ tags: ['Gutachten'], topics: ['Fluchtweg'] })
    })

    it('rewrites the search row of the retagged document once the backend took the tags', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)
      vi.mocked(refreshSearchRows).mockClear()
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ tags: ['Gutachten'] }) })

      await updateDocumentTags(session, 'doc-1', ['Gutachten'])

      expect(refreshSearchRows).toHaveBeenCalledWith(session.organizationId, [humanDoc])
    })

    it('rewrites no search row when the backend refused the tags', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)
      vi.mocked(refreshSearchRows).mockClear()
      mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({}) })

      await expect(updateDocumentTags(session, 'doc-1', ['Gutachten'])).rejects.toThrow()
      expect(refreshSearchRows).not.toHaveBeenCalled()
    })

    it('leaves topics out of the PATCH body and the answer when the edit does not carry them', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ tags: ['Gutachten'] }),
      })

      const result = await updateDocumentTags(session, 'doc-1', ['Gutachten'])

      expect(result).not.toHaveProperty('topics')
      const init = documentCalls()[0]?.[1] as RequestInit
      expect(JSON.parse(String(init.body))).toEqual({ tags: ['Gutachten'] })
    })

    it('rejects too many topics, or an empty or overlong one, before calling the backend', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)

      await expect(
        updateDocumentTags(session, 'doc-1', [], ['a', 'b', 'c', 'd', 'e', 'f', 'g'])
      ).rejects.toBeInstanceOf(BadRequestError)
      await expect(updateDocumentTags(session, 'doc-1', [], [''])).rejects.toBeInstanceOf(BadRequestError)
      await expect(updateDocumentTags(session, 'doc-1', [], ['x'.repeat(41)])).rejects.toBeInstanceOf(
        BadRequestError
      )
      expect(documentCalls()).toHaveLength(0)
    })
  })

  describe('renameDocument', () => {
    it('renames a machine-authored row without retitling the colliding document', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentDoc)

      await renameDocument(session, 'doc-agent', 'Projektbericht.pdf', new Request('http://x'))

      expect(setDocumentDisplayName).toHaveBeenCalledWith(
        'doc-agent',
        'org-1',
        'Projektbericht.pdf'
      )
      expect(documentCalls()).toHaveLength(0)
    })

    it('still mirrors the rename for the human document with the same filename', async () => {
      vi.mocked(findDocumentInOrg).mockResolvedValue(humanDoc)

      await renameDocument(session, 'doc-1', 'Einreichplan.pdf', new Request('http://x'))

      expect(String(documentCalls()[0]?.[0])).toBe(
        `http://backend:8000/v1/collections/proj_abc/documents/${collidingName}/display-title`
      )
    })
  })

  describe('reindexProject', () => {
    it('skips a machine-authored row without touching the colliding chunks', async () => {
      vi.mocked(listProjectDocumentPage).mockResolvedValueOnce({ nextCursor: null, rows: [
        {
          id: 'doc-agent',
          filename: collidingName,
          projectId: 'proj-1',
          scope: 'project',
          displayName: null,
          lifecycle: 'active',
          publishedVersionId: null,
          originPath: null,
          contentHash: null,
          createdBy: 'user-1',
          screeningOutcome: null,
          screenedHash: null,
          fileSize: 1024,
          contentType: 'application/pdf',
          status: 'stored' as const,
          authoredBy: 'agent',
          collectionName: 'proj_abc',
          folderId: null,
          createdAt: new Date('2026-08-20T00:00:00Z'),
          updatedAt: new Date('2026-08-20T00:00:00Z'),
          errorMessage: null,
          metadata: null,
        },
      ] })
      vi.mocked(findDocumentInOrg).mockResolvedValue(agentDoc)

      const result = await runReindexSlice(session, sliceState())

      expect(result.done).toBe(true)
      expect(result.payload.counts).toEqual({ queued: 0, skipped: 1, failed: 0, failedNames: [] })
      expect(documentCalls()).toHaveLength(0)
    })
  })
})

describe('reindexProject', () => {
  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
  })

  it('checks the caller may rebuild the project, then queues ONE bulk job and answers with its id', async () => {
    const result = await reindexProject(session, 'proj-1')

    expect(requireProjectAccess).toHaveBeenCalledWith(session, 'proj-1', ['project:documents:write', 'project:edit'])
    expect(result).toEqual({ projectId: 'proj-1', jobId: 'job-1' })
    expect(enqueueJob).toHaveBeenCalledTimes(1)
    const queued = vi.mocked(enqueueJob).mock.calls[0][0]
    expect(queued).toMatchObject({ kind: 'reindex_project', organizationId: 'org-1' })
    expect(queued.priority).toBeUndefined() // the queue's default: bulk
    expect(queued.payload).toEqual({
      projectId: 'proj-1',
      requester: {
        userId: 'user-1',
        email: 'user@example.com',
        organizationMembershipId: 'om-1',
        role: 'member',
        permissions: [],
      },
      cursor: null,
      counts: emptyCounts(),
    })
  })

  it('does not copy the access token into the job', async () => {
    await reindexProject(session, 'proj-1')

    expect(JSON.stringify(vi.mocked(enqueueJob).mock.calls[0][0])).not.toContain('test-access-token')
  })

  it('queues nothing for a caller who may not rebuild the project', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValue(new NotFoundError())

    await expect(reindexProject(session, 'proj-1')).rejects.toBeInstanceOf(NotFoundError)

    expect(enqueueJob).not.toHaveBeenCalled()
  })

  it('answers a second click with the job already doing it', async () => {
    vi.mocked(findOpenJobId).mockResolvedValueOnce('job-open')

    const result = await reindexProject(session, 'proj-1')

    expect(result).toEqual({ projectId: 'proj-1', jobId: 'job-open' })
    expect(findOpenJobId).toHaveBeenCalledWith({
      kind: 'reindex_project',
      organizationId: 'org-1',
      matching: { projectId: 'proj-1' },
    })
    expect(enqueueJob).not.toHaveBeenCalled()
  })
})

describe('runReindexSlice', () => {
  const listRow = (id: string, filename: string): DocumentListRow => ({
  projectId: 'proj-1',
  scope: 'project',
    id,
    filename,
    displayName: null,
    lifecycle: 'active',
    publishedVersionId: null,
    originPath: null,
    contentHash: null,
    createdBy: 'user-1',
    screeningOutcome: null,
    screenedHash: null,
    fileSize: 1024,
    contentType: 'application/pdf',
    status: 'completed' as const,
    authoredBy: 'user' as const,
    collectionName: 'proj_abc',
    folderId: null,
    createdAt: new Date('2026-08-20T00:00:00Z'),
    updatedAt: new Date('2026-08-20T00:00:00Z'),
    errorMessage: null,
    metadata: null,
  })

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
  })

  it('re-dispatches without deleting the current chunks first', async () => {
    vi.mocked(listProjectDocumentPage).mockResolvedValueOnce({ rows: [listRow('doc-1', 'plan.pdf')], nextCursor: null })
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-1', filename: 'plan.pdf', status: 'completed' as const, storageKey: 'k/plan.pdf' })
    )
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ job_id: 'job-1' }) })

    const result = await runReindexSlice(session, sliceState())

    expect(result.done).toBe(true)
    expect(result.payload.counts).toEqual({ queued: 1, skipped: 0, failed: 0, failedNames: [] })
    const methods = mockFetch.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method)
    expect(methods).not.toContain('DELETE')
    expect(mockFetch.mock.calls.map(([url]) => String(url))).toEqual([
      expect.stringContaining('/v1/ingest'),
    ])
    expect(setDocumentIngestJob).toHaveBeenCalledWith('doc-1', 'org-1', 'job-1', null, expect.objectContaining({ ingestJobId: null }))
  })

  it('dispatches every document with bulk priority, so a person’s upload goes first', async () => {
    vi.mocked(listProjectDocumentPage).mockResolvedValueOnce({ rows: [listRow('doc-1', 'plan.pdf')], nextCursor: null })
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-1', filename: 'plan.pdf', status: 'completed' as const, storageKey: 'k/plan.pdf' })
    )
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ job_id: 'job-1' }) })

    await runReindexSlice(session, sliceState())

    const body = JSON.parse(String((mockFetch.mock.calls[0][1] as RequestInit).body))
    expect(body.priority).toBe('bulk')
  })

  it('reports a failed dispatch by name, and sends nothing that removes chunks', async () => {
    vi.mocked(listProjectDocumentPage).mockResolvedValueOnce({ rows: [listRow('doc-1', 'plan.pdf')], nextCursor: null })
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-1', filename: 'plan.pdf', status: 'completed' as const, storageKey: 'k/plan.pdf' })
    )
    mockFetch.mockRejectedValue(new Error('backend down'))

    const result = await runReindexSlice(session, sliceState())

    expect(result.payload.counts).toEqual({ queued: 0, skipped: 0, failed: 1, failedNames: ['plan.pdf'] })
    const methods = mockFetch.mock.calls.map(([, init]) => (init as RequestInit | undefined)?.method)
    expect(methods).not.toContain('DELETE')
  })

  it.each(['pending', 'processing'] as const)('skips a row that is %s', async (status) => {
    vi.mocked(listProjectDocumentPage).mockResolvedValueOnce({ rows: [listRow('doc-1', 'plan.pdf')], nextCursor: null })
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-1', filename: 'plan.pdf', status, storageKey: 'k/plan.pdf' })
    )

    const result = await runReindexSlice(session, sliceState())

    expect(result.payload.counts).toEqual({ queued: 0, skipped: 1, failed: 0, failedNames: [] })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('skips a quarantined document it may see, and reports it as skipped, not queued', async () => {
    vi.mocked(listProjectDocumentPage).mockResolvedValueOnce({ rows: [listRow('doc-1', 'plan.pdf')], nextCursor: null })
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-1',
        filename: 'plan.pdf',
        status: 'quarantined' as const,
        storageKey: 'k/plan.pdf',
        createdBy: session.userId,
      })
    )

    const result = await runReindexSlice(session, sliceState())

    expect(result.payload.counts).toEqual({ queued: 0, skipped: 1, failed: 0, failedNames: [] })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(setDocumentIngestJob).not.toHaveBeenCalled()
  })

  it('takes one page, returns the cursor to resume from, and carries the counts across slices', async () => {
    const cursor = { createdAt: '2026-08-20T00:00:00.000000', id: 'doc-1' }
    vi.mocked(listProjectDocumentPage)
      .mockResolvedValueOnce({ rows: [listRow('doc-1', 'plan.pdf')], nextCursor: cursor })
      .mockResolvedValueOnce({ rows: [listRow('doc-2', 'old.pdf')], nextCursor: null })
    vi.mocked(findDocumentInOrg).mockImplementation(async (id: string) =>
      makeDocument({ id, filename: `${id}.pdf`, status: 'completed' as const, storageKey: `k/${id}.pdf` })
    )
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ job_id: 'job-1' }) })

    const first = await runReindexSlice(session, sliceState())
    expect(first.done).toBe(false)
    expect(first.payload.cursor).toEqual(cursor)
    expect(first.payload.counts.queued).toBe(1)

    const saved: ReindexProjectPayload = JSON.parse(JSON.stringify(first.payload))
    const second = await runReindexSlice(session, saved)

    expect(second.done).toBe(true)
    expect(second.payload.counts.queued).toBe(2)
    expect(listProjectDocumentPage).toHaveBeenNthCalledWith(1, 'proj-1', 'org-1', {
      reader: { kind: 'internal', why: 'ingest' },
      authoredBy: 'user',
      cursor: undefined,
      limit: REINDEX_SLICE_DOCUMENTS,
    })
    expect(listProjectDocumentPage).toHaveBeenNthCalledWith(2, 'proj-1', 'org-1', {
      reader: { kind: 'internal', why: 'ingest' },
      authoredBy: 'user',
      cursor,
      limit: REINDEX_SLICE_DOCUMENTS,
    })
  })

  it('stops, without an error, when the requester has lost access since the job was queued', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValue(new NotFoundError())

    const result = await runReindexSlice(session, sliceState())

    expect(result.done).toBe(true)
    expect(listProjectDocumentPage).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('lets any other failure of the access check fail the attempt', async () => {
    vi.mocked(requireProjectAccess).mockRejectedValue(new UpstreamError('WorkOS is down'))

    await expect(runReindexSlice(session, sliceState())).rejects.toBeInstanceOf(UpstreamError)
  })

  it('keeps the first names of failures but counts every one', async () => {
    const rows = Array.from({ length: 25 }, (_, i) => listRow(`doc-${i}`, `plan-${i}.pdf`))
    vi.mocked(listProjectDocumentPage).mockResolvedValueOnce({ rows, nextCursor: null })
    vi.mocked(findDocumentInOrg).mockImplementation(async (id: string) =>
      makeDocument({ id, filename: `${id}.pdf`, status: 'completed' as const, storageKey: `k/${id}.pdf` })
    )
    mockFetch.mockRejectedValue(new Error('backend down'))

    const result = await runReindexSlice(session, sliceState())

    expect(result.payload.counts.failed).toBe(25)
    expect(result.payload.counts.failedNames).toHaveLength(20)
  })
})

describe('the org-wide rescan of failed ingestions', () => {
  const rescanState = (overrides: Partial<ReingestFailedPayload> = {}): ReingestFailedPayload => ({
    requester: sliceState().requester,
    cursor: null,
    counts: emptyCounts(),
    ...overrides,
  })

  describe('reingestFailedOrgDocuments', () => {
    it('queues ONE bulk job for the organization and answers with its id', async () => {
      const result = await reingestFailedOrgDocuments(session)

      expect(result).toEqual({ jobId: 'job-1' })
      expect(vi.mocked(enqueueJob).mock.calls[0][0]).toMatchObject({
        kind: 'reingest_failed',
        organizationId: 'org-1',
        payload: { cursor: null, counts: emptyCounts() },
      })
    })

    it('answers a second click with the rescan already running', async () => {
      vi.mocked(findOpenJobId).mockResolvedValueOnce('job-open')

      expect(await reingestFailedOrgDocuments(session)).toEqual({ jobId: 'job-open' })
      expect(enqueueJob).not.toHaveBeenCalled()
    })
  })

  describe('runReingestFailedSlice', () => {
    const failedDoc = (id: string) =>
      makeDocument({ id, filename: `${id}.pdf`, status: 'failed' as const, authoredBy: 'user', storageKey: `k/${id}.pdf` })

    const admin: AuthorizedSession = { ...session, role: 'admin', permissions: ['org:settings:manage'] }

    beforeEach(() => {
      vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
      mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ job_id: 'job-1' }) })
    })

    it('stops, without touching a document, when the requester no longer holds the permission the route is gated on', async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined)

      const result = await runReingestFailedSlice(session, rescanState()) // `session` is a plain member

      expect(result.done).toBe(true)
      expect(listFailedDocumentPageInOrg).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
      expect(recordAuditEvent).not.toHaveBeenCalled()
    })

    it('sends a page of failed documents back with bulk priority and counts them', async () => {
      vi.mocked(listFailedDocumentPageInOrg).mockResolvedValueOnce({ ids: ['doc-1'], nextCursor: null })
      vi.mocked(findDocumentInOrg).mockResolvedValue(failedDoc('doc-1'))

      const result = await runReingestFailedSlice(admin, rescanState())

      expect(result.done).toBe(true)
      expect(result.payload.counts).toEqual({ queued: 1, skipped: 0, failed: 0, failedNames: [] })
      expect(JSON.parse(String((mockFetch.mock.calls[0][1] as RequestInit).body)).priority).toBe('bulk')
      expect(listFailedDocumentPageInOrg).toHaveBeenCalledWith('org-1', {
        limit: REINGEST_SLICE_DOCUMENTS,
        cursor: null,
      })
    })

    it('resumes the walk from the cursor it returned, and audits only when the set is exhausted', async () => {
      const cursor = { createdAt: '2026-08-20T00:00:00.000000', id: 'doc-1' }
      vi.mocked(listFailedDocumentPageInOrg)
        .mockResolvedValueOnce({ ids: ['doc-1'], nextCursor: cursor })
        .mockResolvedValueOnce({ ids: ['doc-2'], nextCursor: null })
      vi.mocked(findDocumentInOrg).mockImplementation(async (id: string) => failedDoc(id))

      const first = await runReingestFailedSlice(admin, rescanState())
      expect(first.done).toBe(false)
      expect(first.payload.cursor).toEqual(cursor)
      expect(recordAuditEvent).not.toHaveBeenCalled()

      const second = await runReingestFailedSlice(admin, JSON.parse(JSON.stringify(first.payload)))

      expect(second.done).toBe(true)
      expect(listFailedDocumentPageInOrg).toHaveBeenLastCalledWith('org-1', {
        limit: REINGEST_SLICE_DOCUMENTS,
        cursor,
      })
      expect(recordAuditEvent).toHaveBeenCalledTimes(1)
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'org.documents.reingested',
          actor: { userId: 'user-1', email: 'user@example.com' },
          metadata: { total: 2, queued: 2, skipped: 0, failed: 0, truncated: false },
        })
      )
    })

    it('counts a row that is not retryable as skipped, never as a failure', async () => {
      vi.mocked(listFailedDocumentPageInOrg).mockResolvedValueOnce({ ids: ['doc-1', 'doc-2', 'doc-3'], nextCursor: null })
      vi.mocked(findDocumentInOrg).mockImplementation(async (id: string) =>
        id === 'doc-1' ? failedDoc(id) : id === 'doc-2' ? makeDocument({ id, status: 'completed' as const, authoredBy: 'agent', storageKey: 'k' }) : (null as never)
      )

      const result = await runReingestFailedSlice(admin, rescanState())

      expect(result.payload.counts).toEqual({ queued: 1, skipped: 2, failed: 0, failedNames: [] })
    })

    it('records the id of a document whose retry itself went wrong', async () => {
      vi.mocked(listFailedDocumentPageInOrg).mockResolvedValueOnce({ ids: ['doc-1'], nextCursor: null })
      vi.mocked(findDocumentInOrg).mockResolvedValue(failedDoc('doc-1'))
      mockFetch.mockRejectedValue(new Error('backend down'))

      const result = await runReingestFailedSlice(admin, rescanState())

      expect(result.payload.counts).toEqual({ queued: 0, skipped: 0, failed: 1, failedNames: ['doc-1'] })
      expect(recordAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({ metadata: expect.objectContaining({ failed: 1 }) })
      )
    })
  })
})

describe('getDocumentTextPreview', () => {
  const textDoc = (contentType: string) =>
    makeDocument({
      id: 'doc-text',
      filename: 'katalog.csv',
      contentType,
      storageKey: 'org/org-1/project/proj-1/doc/doc-text/katalog.csv',
    })

  const bodyOf = (text: string) => ({
    transformToByteArray: async () => new TextEncoder().encode(text),
  })

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
  })

  it('returns the bytes as text for a format the pane renders itself', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(textDoc('text/csv'))
    vi.mocked(s3Client.send).mockResolvedValue({ Body: bodyOf('a;b\n1;2\n') } as never)

    await expect(getDocumentTextPreview(session, 'doc-text')).resolves.toMatchObject({
      text: 'a;b\n1;2\n',
      truncated: false,
    })
  })

  it('refuses a content type it is not for', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(textDoc('application/pdf'))

    await expect(getDocumentTextPreview(session, 'doc-text')).rejects.toMatchObject({
      status: 415,
    })
  })

  it('never serves HTML, which would be script in a same-origin response', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(textDoc('text/html'))

    await expect(getDocumentTextPreview(session, 'doc-text')).rejects.toMatchObject({
      status: 415,
    })
  })

  it('bounds the response and says it did, rather than cutting the file silently', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(textDoc('text/plain'))
    const oversized = 'x'.repeat(256 * 1024) + '\nlast'
    vi.mocked(s3Client.send).mockResolvedValue({ Body: bodyOf(oversized) } as never)

    const result = await getDocumentTextPreview(session, 'doc-text')

    expect(result.truncated).toBe(true)
    expect(result.text.length).toBeLessThanOrEqual(256 * 1024)
  })

  it('asks the object store for a bounded range, not for the whole object', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(textDoc('text/plain'))
    vi.mocked(s3Client.send).mockResolvedValue({ Body: bodyOf('short') } as never)

    await getDocumentTextPreview(session, 'doc-text')

    const command = vi.mocked(s3Client.send).mock.calls.at(-1)?.[0] as
      | { input?: { Range?: string } }
      | undefined
    expect(command?.input?.Range).toBe(`bytes=0-${256 * 1024}`)
  })

  it('previews a cp1252 CSV as its text, not as replacement glyphs', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(textDoc('text/csv'))
    const cp1252 = Uint8Array.from([0x4d, 0x61, 0xdf, 0x3b, 0x48, 0xf6, 0x68, 0x65, 0x0a, 0x80, 0x0a])
    vi.mocked(s3Client.send).mockResolvedValue({
      Body: { transformToByteArray: async () => cp1252 },
    } as never)

    const { text } = await getDocumentTextPreview(session, 'doc-text')

    expect(text).toBe('Maß;Höhe\n€\n')
  })

  it('keeps a UTF-8 file UTF-8 when the range cut lands inside a character', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(textDoc('text/plain'))
    const head = 'x'.repeat(256 * 1024 - 4) + '\n'
    vi.mocked(s3Client.send).mockResolvedValue({ Body: bodyOf(head + 'ä'.repeat(4)) } as never)

    const { text, truncated } = await getDocumentTextPreview(session, 'doc-text')

    expect(truncated).toBe(true)
    expect(text).toBe('x'.repeat(256 * 1024 - 4))
    expect(text).not.toContain('Ã')
  })

  it('404s a document with no stored object', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-text', contentType: 'text/plain', storageKey: undefined })
    )

    await expect(getDocumentTextPreview(session, 'doc-text')).rejects.toBeInstanceOf(NotFoundError)
  })
})


describe('re-uploading a filename this collection already holds', () => {
  const existing = makeLiveDocumentMatch({
    id: 'doc-existing',
    storageKey: 'org/org-1/project/proj-1/doc/doc-existing/plan.pdf',
    storageBucket: 'test-bucket',
    fileSize: 900,
    contentHash: null,
    folderId: null,
    status: 'ready',
  })

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findProjectInOrg).mockResolvedValue(
      makeProject({ id: 'proj-1', collectionName: 'proj_abc' }),
    )
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(existing)
  })

  afterEach(() => {
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(null)
  })

  describe('onto a quarantined file', () => {
    beforeEach(() => {
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue({ ...existing, status: 'quarantined' as const })
      vi.mocked(requireProjectAccess).mockImplementation(async (_s, _projectId, permission) => {
        if (permission === 'project:manage') throw new NotFoundError('Project not found')
        return { role: 'project-viewer', closed: false, readsBecauseClosed: false }
      })
    })

    it("refuses to replace somebody else's", async () => {
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue({
        ...existing,
        createdBy: 'user-other',
        status: 'quarantined' as const,
      })

      const refusal = uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))
      await expect(refusal).rejects.toBeInstanceOf(ConflictError)
      await expect(refusal).rejects.toMatchObject({ details: { reason: NAME_TAKEN_REASON } })
      const details = await refusal.catch((error: ConflictError) => error.details)
      expect(details).toStrictEqual({ reason: NAME_TAKEN_REASON })
      expect(admitReplacementOrDiscard).not.toHaveBeenCalled()
    })

    it('refuses its uploader too, saying it waits in quarantine and naming it', async () => {
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue({ ...existing, createdBy: 'user-1', status: 'quarantined' as const })

      const refusal = uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))
      await expect(refusal).rejects.toBeInstanceOf(ConflictError)
      await expect(refusal).rejects.toMatchObject({
        details: { reason: 'quarantined', documentId: 'doc-existing', ownUpload: true },
      })
      expect(admitReplacementOrDiscard).not.toHaveBeenCalled()
    })
  })

  it('keeps the document id, so nothing that referenced it breaks', async () => {
    const result = await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    expect(result.documentId).toBe('doc-existing')
  })

  it('replaces the row instead of inserting a second one', async () => {
    await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    expect(admitOrDiscard).not.toHaveBeenCalled()
    expect(admitReplacementOrDiscard).toHaveBeenCalled()
    const call = vi.mocked(admitReplacementOrDiscard).mock.calls.at(-1)
    expect(call?.[3]).toBe('doc-existing')
  })

  it('writes its bytes to a key no overlapping re-upload can share', async () => {
    await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))
    await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    const keys = vi
      .mocked(s3Client.send)
      .mock.calls.map(([command]) => (command as unknown as { input: { Key?: string } }).input.Key)
      .filter((key): key is string => typeof key === 'string' && key.endsWith('/plan.pdf'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).toMatch(/\/doc\/doc-existing\/v2\/[0-9a-f]{12}\/plan\.pdf$/)
    expect(keys[0]).not.toBe(keys[1])
  })

  it('records the version with the key THIS upload stored, not whatever the row says now', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({
        id: 'doc-existing',
        storageKey: 'org/org-1/project/proj-1/doc/doc-existing/v2/000000000000/plan.pdf',
      }),
    )

    await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    const put = vi
      .mocked(s3Client.send)
      .mock.calls.map(([command]) => (command as unknown as { input: { Key?: string } }).input.Key)
      .find((key) => typeof key === 'string' && key.endsWith('/plan.pdf'))
    const recorded = vi.mocked(insertPublishedVersion).mock.calls.at(-1)?.[0]
    expect(recorded?.storageKey).toBe(put)
    expect(recorded?.storageKey).not.toContain('/000000000000/')
    expect(recorded).not.toHaveProperty('versionNumber')
  })

  it('records that these are new bytes rather than a new document', async () => {
    await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    const event = vi.mocked(recordAuditEvent).mock.calls.at(-1)?.[0]
    expect(event?.targetId).toBe('doc-existing')
    expect(event?.metadata).toMatchObject({ replaced: true })
  })

  it('still inserts when the filename is genuinely new', async () => {
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(null)

    const result = await uploadDocument(session, makeInput({ name: 'neu.pdf' }), new Request('http://x'))

    expect(admitOrDiscard).toHaveBeenCalled()
    expect(result.documentId).not.toBe('doc-existing')
  })

  it('dispatches the replaced document for ingestion under its own id', async () => {
    const result = await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    expect(result.documentId).toBe('doc-existing')
    const dispatched = mockFetch.mock.calls.some(([url]) => String(url).includes('/v1/ingest'))
    expect(dispatched).toBe(true)
  })

  describe('and the bytes are the ones already stored', () => {
    const digestOfInput = 'sha256:' + createHash('sha256').update(Buffer.from(new ArrayBuffer(8))).digest('hex')

    it('writes nothing, ingests nothing, and keeps the document', async () => {
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue(makeLiveDocumentMatch({
        ...existing,
        contentHash: digestOfInput,
      }))

      const result = await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

      expect(result.documentId).toBe('doc-existing')
      expect(admitReplacementOrDiscard).not.toHaveBeenCalled()
      expect(admitOrDiscard).not.toHaveBeenCalled()
      expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/v1/ingest'))).toBe(false)
    })

    it('still re-ingests when the document has not landed — a failure must be retryable', async () => {
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue(makeLiveDocumentMatch({
        ...existing,
        contentHash: digestOfInput,
        status: 'failed' as const,
      }))

      await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

      expect(admitReplacementOrDiscard).toHaveBeenCalled()
    })

    it('still runs when the upload re-files it, because the move is the point', async () => {
      vi.mocked(findLiveDocumentByFilename).mockResolvedValue(makeLiveDocumentMatch({
        ...existing,
        contentHash: digestOfInput,
        folderId: 'folder-elsewhere',
      }))

      await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

      expect(admitReplacementOrDiscard).toHaveBeenCalled()
    })
  })

  it('probes and stores the name in one Unicode form', async () => {
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(null)

    const result = await uploadDocument(
      session,
      makeInput({ name: 'Pru\u0308fbericht.pdf' }),
      new Request('http://x'),
    )

    expect(vi.mocked(findLiveDocumentByFilename).mock.calls.at(-1)?.[2]).toBe('Pr\u00fcfbericht.pdf')
    expect(vi.mocked(admitOrDiscard).mock.calls.at(-1)?.[2]).toMatchObject({
      filename: 'Pr\u00fcfbericht.pdf',
    })
    expect(result.filename).toBe('Pr\u00fcfbericht.pdf')
  })
})

describe('a delete that lands after the upload wrote its row', () => {
  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findProjectInOrg).mockResolvedValue(
      makeProject({ id: 'proj-1', collectionName: 'proj_abc' }),
    )
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(null)
    vi.mocked(findDocumentInOrg).mockResolvedValue(null)
  })

  it('answers 409, dispatches nothing and takes its object back', async () => {
    await expect(
      uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x')),
    ).rejects.toMatchObject({ status: 409, details: { reason: 'deleted_during_upload' } })

    expect(insertPublishedVersion).not.toHaveBeenCalled()
    expect(mockFetch.mock.calls.some(([url]) => String(url).includes('/v1/ingest'))).toBe(false)
    expect(recordAuditEvent).not.toHaveBeenCalled()
    const commands = vi.mocked(s3Client.send).mock.calls.map(([command]) => command as unknown as {
      constructor: { name: string }
      input: { Key?: string }
    })
    const put = commands.find((command) => command.constructor.name === 'PutObjectCommand')
    const removed = commands.filter((command) => command.constructor.name === 'DeleteObjectCommand')
    expect(removed.map((command) => command.input.Key)).toContain(put?.input.Key)
  })

  it('does not retry it as a first upload', async () => {
    await expect(
      uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x')),
    ).rejects.toMatchObject({ status: 409 })
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
  })
})

describe('a re-upload whose document is deleted underneath it', () => {
  const existing = makeLiveDocumentMatch({
    id: 'doc-deleted',
    storageKey: 'org/org-1/project/proj-1/doc/doc-deleted/plan.pdf',
    storageBucket: 'test-bucket',
    fileSize: 900,
    contentHash: null,
    folderId: null,
    status: 'ready',
  })

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findProjectInOrg).mockResolvedValue(
      makeProject({ id: 'proj-1', collectionName: 'proj_abc' }),
    )
    vi.mocked(findLiveDocumentByFilename).mockResolvedValueOnce(existing).mockResolvedValueOnce(null)
    vi.mocked(admitReplacementOrDiscard).mockRejectedValueOnce(
      new ReplacedDocumentGoneError('doc-deleted'),
    )
  })

  afterEach(() => {
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(null)
  })

  it('files the bytes as a first upload under a new id', async () => {
    const result = await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    expect(admitReplacementOrDiscard).toHaveBeenCalledTimes(1)
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
    const inserted = vi.mocked(admitOrDiscard).mock.calls.at(-1)
    expect(inserted?.[2]).toMatchObject({ filename: 'plan.pdf' })
    expect(inserted?.[2].id).not.toBe('doc-deleted')
    expect(result.documentId).toBe(inserted?.[2].id)
    expect(vi.mocked(recordAuditEvent).mock.calls.at(-1)?.[0]?.metadata).not.toHaveProperty('replaced')
  })
})

describe('two FIRST uploads of one filename at once', () => {
  const winner = makeLiveDocumentMatch({
    id: 'doc-winner',
    storageKey: 'org/org-1/project/proj-1/doc/doc-winner/plan.pdf',
    storageBucket: 'test-bucket',
    fileSize: 8,
    contentHash: null,
    folderId: null,
    status: 'uploaded' as const,
  })

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findProjectInOrg).mockResolvedValue(
      makeProject({ id: 'proj-1', collectionName: 'proj_abc' }),
    )
    vi.mocked(findLiveDocumentByFilename).mockResolvedValueOnce(null).mockResolvedValueOnce(winner)
    vi.mocked(admitOrDiscard).mockRejectedValueOnce(new LiveFilenameTakenError('plan.pdf'))
    vi.mocked(nextVersionNumber).mockResolvedValueOnce(1)
  })

  afterEach(() => {
    vi.mocked(findLiveDocumentByFilename).mockResolvedValue(null)
  })

  it('records the loser as a new version of the winner\u2019s document', async () => {
    const result = await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    expect(result.documentId).toBe('doc-winner')
    expect(admitOrDiscard).toHaveBeenCalledTimes(1)
    expect(vi.mocked(admitReplacementOrDiscard).mock.calls.at(-1)?.[3]).toBe('doc-winner')
    expect(vi.mocked(findDocumentInOrg).mock.calls.at(-1)?.[0]).toBe('doc-winner')
    expect(insertPublishedVersion).toHaveBeenCalledTimes(1)
    expect(vi.mocked(recordAuditEvent).mock.calls.at(-1)?.[0]?.metadata).toMatchObject({
      replaced: true,
    })
  })

  it('writes the retry under a write key of its own, never over the winner\u2019s bytes', async () => {
    await uploadDocument(session, makeInput({ name: 'plan.pdf' }), new Request('http://x'))

    const keys = vi
      .mocked(s3Client.send)
      .mock.calls.map(([command]) => (command as unknown as { input: { Key?: string } }).input.Key)
      .filter((key): key is string => typeof key === 'string' && key.endsWith('/plan.pdf'))
    expect(keys).toHaveLength(2)
    expect(keys[0]).not.toContain('doc-winner')
    expect(keys[1]).toMatch(/\/doc\/doc-winner\/v1\/[0-9a-f]{12}\/plan\.pdf$/)
    expect(keys[1]).not.toBe(winner.storageKey)
    expect(vi.mocked(admitReplacementOrDiscard).mock.calls.at(-1)?.[1]).toBe(keys[1])
    expect(vi.mocked(admitReplacementOrDiscard).mock.calls.at(-1)?.[4]).toMatchObject({
      storageKey: keys[1],
      fileSize: 1234,
    })
  })
})

describe('thumbnails ignore empty objects', () => {
  it('getDocumentThumbnail returns null when the thumbnail object is empty', async () => {
    vi.mocked(s3Client.send).mockResolvedValue({ ContentLength: 0 } as never)

    await expect(getDocumentThumbnail(session, 'doc-1')).resolves.toEqual({ url: null })
    expect(vi.mocked(getSignedUrl)).not.toHaveBeenCalled()
  })

  it('getDocumentThumbnail still serves a non-empty thumbnail', async () => {
    vi.mocked(s3Client.send).mockResolvedValue({ ContentLength: 48211 } as never)

    await expect(getDocumentThumbnail(session, 'doc-1')).resolves.toEqual({
      url: 'https://seaweedfs.internal/presigned',
    })
  })

  it('streamDocumentImage 404s an empty thumbnail object', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-secret')
    const imageUrl = new URL(buildDocumentImageUrl('org-1', 'user-1', 'doc-1', 'thumb')!, 'https://grid.test')
    vi.mocked(s3Client.send).mockResolvedValue({ ContentLength: 0, Body: undefined } as never)

    await expect(streamDocumentImage('doc-1', imageUrl.searchParams)).rejects.toBeInstanceOf(
      NotFoundError
    )
  })
})

describe('an office document is viewed through its PDF rendition', () => {
  const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const ORIGINAL_KEY = 'org/org-1/project/proj-1/doc/doc-office/v1/Baubeschreibung.docx'
  const RENDITION_KEY = 'org/org-1/project/proj-1/doc/doc-office/v1/_render.pdf'
  const officeDoc = () =>
    makeDocument({ id: 'doc-office', filename: 'Baubeschreibung.docx', contentType: DOCX, storageKey: ORIGINAL_KEY })
  const signedInputs = () =>
    vi.mocked(getSignedUrl).mock.calls.map(([, command]) => (command as { input: Record<string, unknown> }).input)
  const commandOf = (call: number) =>
    (vi.mocked(s3Client.send).mock.calls[call][0] as unknown as { input: Record<string, unknown> }).input

  beforeEach(() => {
    vi.stubEnv('GOTENBERG_URL', 'http://gotenberg:3000')
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findDocumentInOrg).mockResolvedValue(officeDoc())
    vi.mocked(getSignedUrl).mockClear()
    vi.mocked(s3Client.send).mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
    vi.mocked(s3Client.send).mockReset().mockResolvedValue(undefined as never)
  })

  it('previews an existing rendition without converting again', async () => {
    vi.mocked(s3Client.send).mockResolvedValue({ ContentLength: 2048 } as never)
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    await expect(getDocumentPreview(session, 'doc-office')).resolves.toMatchObject({
      contentType: 'application/pdf',
      rendition: true,
      sourceContentType: DOCX,
      filename: 'Baubeschreibung.docx',
    })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(signedInputs()[0]).toMatchObject({ Key: RENDITION_KEY, ResponseContentType: 'application/pdf' })
  })

  it('converts on first read when no rendition exists yet', async () => {
    vi.mocked(s3Client.send).mockImplementation((async (command: unknown) => {
      if (command instanceof HeadObjectCommand) throw Object.assign(new Error('NotFound'), { name: 'NotFound' })
      if (command instanceof GetObjectCommand) return { Body: { transformToByteArray: async () => new Uint8Array([1]) } }
      return {}
    }) as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(new TextEncoder().encode('%PDF-1.7'))))

    await getDocumentPreview(session, 'doc-office')

    const put = vi
      .mocked(s3Client.send)
      .mock.calls.map(([c]) => c as unknown)
      .find((c): c is PutObjectCommand => c instanceof PutObjectCommand)
    expect(put?.input).toMatchObject({ Key: RENDITION_KEY, ContentType: 'application/pdf' })
  })

  it('streams the rendition, not the original, to the viewer', async () => {
    vi.mocked(s3Client.send)
      .mockResolvedValueOnce({ ContentLength: 2048 } as never)
      .mockResolvedValueOnce({ Body: { transformToWebStream: () => new ReadableStream() } } as never)

    const response = await streamDocumentFile(session, 'doc-office')

    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(commandOf(1)).toMatchObject({ Key: RENDITION_KEY })
  })

  it('downloads the ORIGINAL — the rendition is only ever a view', async () => {
    const download = await getDocumentDownload(session, 'doc-office')

    expect(download).toMatchObject({ filename: 'Baubeschreibung.docx', contentType: DOCX })
    expect(signedInputs()[0]).toMatchObject({ Key: ORIGINAL_KEY })
    expect(String(signedInputs()[0].ResponseContentDisposition)).toContain('attachment')
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('downloads the rendition as a PDF named after the original when asked for format=pdf', async () => {
    vi.mocked(s3Client.send).mockResolvedValue({ ContentLength: 2048 } as never)

    const download = await getDocumentDownload(session, 'doc-office', { format: 'pdf' })

    expect(download).toMatchObject({ filename: 'Baubeschreibung.pdf', contentType: 'application/pdf', fileSize: null })
    expect(signedInputs()[0]).toMatchObject({ Key: RENDITION_KEY, ResponseContentType: 'application/pdf' })
    expect(String(signedInputs()[0].ResponseContentDisposition)).toContain('attachment')
    expect(recordDocumentAccess).toHaveBeenCalledWith(session, expect.objectContaining({ id: 'doc-office' }), 'download')
  })

  it('answers format=pdf for a stored PDF with the file itself, and refuses a file with no PDF form', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-office', filename: 'Plan.pdf', contentType: 'application/pdf', storageKey: ORIGINAL_KEY })
    )
    await expect(getDocumentDownload(session, 'doc-office', { format: 'pdf' })).resolves.toMatchObject({
      filename: 'Plan.pdf',
    })
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-office', filename: 'notiz.txt', contentType: 'text/plain', storageKey: ORIGINAL_KEY })
    )
    await expect(getDocumentDownload(session, 'doc-office', { format: 'pdf' })).rejects.toMatchObject({ status: 415 })
  })

  it('is the old 415 when conversion is not configured', async () => {
    vi.stubEnv('GOTENBERG_URL', '')

    await expect(getDocumentPreview(session, 'doc-office')).rejects.toMatchObject({ status: 415 })
    await expect(streamDocumentFile(session, 'doc-office')).rejects.toMatchObject({ status: 415 })
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('is a 502 RENDITION_FAILED when the converter fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(s3Client.send).mockImplementation((async (command: unknown) => {
      if (command instanceof HeadObjectCommand) throw new Error('NotFound')
      return { Body: { transformToByteArray: async () => new Uint8Array([1]) } }
    }) as never)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('down', { status: 503 })))

    await expect(getDocumentPreview(session, 'doc-office')).rejects.toMatchObject({
      status: 502,
      code: 'RENDITION_FAILED',
    })
  })

  it('answers a file that just failed to convert at once, instead of converting it on every open', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(s3Client.send).mockImplementation((async (command: unknown) => {
      if (command instanceof HeadObjectCommand) throw new Error('NotFound')
      return { Body: { transformToByteArray: async () => new Uint8Array([1]) } }
    }) as never)
    const fetchSpy = vi.fn().mockResolvedValue(new Response('LibreOffice cannot read this', { status: 400 }))
    vi.stubGlobal('fetch', fetchSpy)

    await expect(getDocumentPreview(session, 'doc-office')).rejects.toMatchObject({ status: 502 })
    const conversions = fetchSpy.mock.calls.length
    await expect(getDocumentPreview(session, 'doc-office')).rejects.toMatchObject({
      status: 502,
      code: 'RENDITION_FAILED',
    })
    await expect(streamDocumentFile(session, 'doc-office')).rejects.toMatchObject({ status: 502 })
    expect(fetchSpy).toHaveBeenCalledTimes(conversions)
  })
})

describe('restricted folders (ADR-0087)', () => {
  const HIDDEN = 'folder-hidden'
  const RESTRICTED_COLLECTION = 'proj_abc_r1111aaaa2222'
  const restricted: ProjectFolderAccess = {
    hiddenFolderIds: new Set([HIDDEN]),
    isVisible: (folderId) => folderId !== HIDDEN,
    collectionFor: (folderId) => (folderId === 'folder-cleared' ? RESTRICTED_COLLECTION : 'proj_abc'),
    clearedRestrictedCollections: [RESTRICTED_COLLECTION],
    levelOf: () => 'write',
    sourceFolderOf: () => null,
    anyRestricted: true,
  }

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findProjectInOrg).mockResolvedValue(makeProject({ collectionName: 'proj_abc' }))
    vi.mocked(getHiddenFolderIds).mockResolvedValue([HIDDEN])
    vi.mocked(getProjectFolderAccess).mockResolvedValue(restricted)
    vi.mocked(reconcileDocumentStatuses).mockResolvedValue([])
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ job_id: 'job-1', hits: [] }) })
  })

  it('leaves a hidden folder out of the listing, the by-name resolve and the name probe', async () => {
    await listDocumentsPage(session, 'proj-1', { level: { sort: 'added', dir: 'desc', limit: 100 } })
    await resolveProjectDocumentsByName(session, 'proj-1', ['Honorar.pdf'])
    await probeProjectDocumentNames(session, 'proj-1', ['Honorar.pdf'])

    expect(vi.mocked(listDocumentLevelPage).mock.calls[0][2]).toMatchObject({ hiddenFolderIds: [HIDDEN] })
    expect(vi.mocked(findProjectDocumentsByFilenames).mock.calls[0][3]).toEqual({ hiddenFolderIds: [HIDDEN], reader: { kind: 'reviewer' } })
    expect(vi.mocked(findProjectDocumentsByNames).mock.calls[0][3]).toEqual({ hiddenFolderIds: [HIDDEN], reader: { kind: 'reviewer' } })
  })

  it('files an upload into the collection its folder puts it in', async () => {
    vi.mocked(findFolderPathInProject).mockResolvedValue('Verwaltung/Verträge')

    await uploadDocument(session, { ...makeInput(), folderId: 'folder-cleared' }, new Request('http://x'))

    expect(vi.mocked(admitOrDiscard).mock.calls[0][2]).toMatchObject({ collectionName: RESTRICTED_COLLECTION })
  })

  it('refuses an upload into a folder the uploader may only read, before a byte is stored (ADR-0088)', async () => {
    vi.mocked(getProjectFolderAccess).mockResolvedValue({
      ...restricted,
      levelOf: (folderId) => (folderId === 'folder-read' ? 'read' : 'write'),
    })
    vi.mocked(findFolderPathInProject).mockResolvedValue('Verwaltung/Verträge')

    await expect(
      uploadDocument(session, { ...makeInput(), folderId: 'folder-read' }, new Request('http://x'))
    ).rejects.toMatchObject({ status: 403, details: { reason: 'folder-read-only' } })
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('refuses a re-upload that would replace a document filed where the uploader may only read', async () => {
    vi.mocked(getProjectFolderAccess).mockResolvedValue({
      ...restricted,
      levelOf: (folderId) => (folderId === 'folder-read' ? 'read' : 'write'),
    })
    vi.mocked(findLiveDocumentByFilename).mockResolvedValueOnce(makeDocument({ folderId: 'folder-read' }))

    await expect(uploadDocument(session, makeInput(), new Request('http://x'))).rejects.toMatchObject({
      status: 403,
      details: { reason: 'folder-read-only' },
    })
    expect(admitReplacementOrDiscard).not.toHaveBeenCalled()
  })

  it('refuses an upload into a folder the uploader may not see, as not found', async () => {
    vi.mocked(findFolderPathInProject).mockResolvedValue('Verwaltung/Honorare')

    await expect(
      uploadDocument(session, { ...makeInput(), folderId: HIDDEN }, new Request('http://x'))
    ).rejects.toBeInstanceOf(NotFoundError)
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })

  it('refuses a name the project already holds under another restriction, naming no folder', async () => {
    vi.mocked(findProjectCollectionsHoldingFilename).mockResolvedValueOnce([RESTRICTED_COLLECTION])

    const refusal = uploadDocument(session, makeInput(), new Request('http://x'))

    await expect(refusal).rejects.toBeInstanceOf(ConflictError)
    await expect(refusal).rejects.not.toThrow(/Honorare|Verwaltung/)
    await expect(refusal).rejects.toMatchObject({ details: { reason: NAME_TAKEN_REASON } })
    expect(admitOrDiscard).not.toHaveBeenCalled()
  })
})

describe('the download log records what leaves', () => {
  const pdf = () =>
    makeDocument({
      id: 'doc-pdf',
      filename: 'plan.pdf',
      contentType: 'application/pdf',
      storageKey: 'org/org-1/project/proj-1/doc/doc-pdf/plan.pdf',
    })

  beforeEach(() => {
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin', closed: false, readsBecauseClosed: false })
    vi.mocked(findDocumentInOrg).mockResolvedValue(pdf())
    vi.mocked(s3Client.send).mockReset()
  })

  it('records a download, with the row the access check returned', async () => {
    await getDocumentDownload(session, 'doc-pdf')

    expect(recordDocumentAccess).toHaveBeenCalledTimes(1)
    expect(recordDocumentAccess).toHaveBeenCalledWith(session, expect.objectContaining({ id: 'doc-pdf' }), 'download')
  })

  it('records a preview', async () => {
    await getDocumentPreview(session, 'doc-pdf')

    expect(recordDocumentAccess).toHaveBeenCalledWith(session, expect.objectContaining({ id: 'doc-pdf' }), 'preview')
  })

  it('records the PDF stream once the object was read', async () => {
    vi.mocked(s3Client.send).mockResolvedValue({ Body: { transformToWebStream: () => new ReadableStream() } } as never)

    await streamDocumentFile(session, 'doc-pdf')

    expect(recordDocumentAccess).toHaveBeenCalledWith(session, expect.objectContaining({ id: 'doc-pdf' }), 'pdf')
  })

  it('records a text preview once the bytes were read', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ id: 'doc-txt', filename: 'a.csv', contentType: 'text/csv', storageKey: 'org/org-1/a.csv' })
    )
    vi.mocked(s3Client.send).mockResolvedValue({
      Body: { transformToByteArray: async () => new TextEncoder().encode('a;b') },
    } as never)

    await getDocumentTextPreview(session, 'doc-txt')

    expect(recordDocumentAccess).toHaveBeenCalledWith(session, expect.objectContaining({ id: 'doc-txt' }), 'text')
  })

  it('records nothing for a request it refused', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ id: 'doc-bin', contentType: 'application/zip', storageKey: 'k' }))
    await expect(getDocumentPreview(session, 'doc-bin')).rejects.toMatchObject({ status: 415 })
    await expect(getDocumentTextPreview(session, 'doc-bin')).rejects.toMatchObject({ status: 415 })
    await expect(streamDocumentFile(session, 'doc-bin')).rejects.toMatchObject({ status: 415 })

    vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ id: 'doc-none', storageKey: '' }))
    await expect(getDocumentDownload(session, 'doc-none')).rejects.toBeInstanceOf(NotFoundError)

    vi.mocked(requireProjectAccess).mockRejectedValue(new ForbiddenError())
    await expect(getDocumentDownload(session, 'doc-pdf')).rejects.toBeInstanceOf(ForbiddenError)

    expect(recordDocumentAccess).not.toHaveBeenCalled()
  })

  it('does not hand the URL over when the log refuses (a folder with its own list)', async () => {
    vi.mocked(recordDocumentAccess).mockRejectedValueOnce(Object.assign(new Error('not recorded'), { status: 503 }))

    await expect(getDocumentDownload(session, 'doc-pdf')).rejects.toMatchObject({ status: 503 })
  })

  it('does not record a thumbnail, which is not the file', async () => {
    vi.mocked(s3Client.send).mockResolvedValue({ ContentLength: 48211 } as never)

    await getDocumentThumbnail(session, 'doc-pdf')

    expect(recordDocumentAccess).not.toHaveBeenCalled()
  })
})
