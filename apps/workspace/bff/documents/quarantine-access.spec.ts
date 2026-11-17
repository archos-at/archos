import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const PAGE = { level: { sort: 'added', dir: 'desc', limit: 100 } } as const

vi.mock('server-only', () => ({}))
vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('@/lib/download-log/service', () => ({ recordDocumentAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/authz/projects', () => ({ requireProjectAccess: vi.fn() }))
vi.mock('@/lib/authz/organizations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/authz/organizations')>()),
  canManageOfficeShelf: vi.fn(() => false),
}))
vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn() },
  signingS3Client: { send: vi.fn() },
  bucketAdminS3Client: { send: vi.fn() },
  bucketName: 'test-bucket',
}))
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://seaweedfs.internal/presigned'),
}))
vi.mock('./repository', () => ({
  findDocumentInOrg: vi.fn(),
  listDocumentLevelPage: vi.fn().mockResolvedValue({ rows: [], nextCursor: null }),
  findProjectDocumentsByFilenames: vi.fn().mockResolvedValue([]),
  findProjectDocumentsByNames: vi.fn().mockResolvedValue([]),
}))
vi.mock('@/lib/projects/repository', () => ({
  findProjectInOrg: vi.fn().mockResolvedValue({ id: 'proj-1', collectionName: 'proj_abc' }),
}))
vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))
vi.mock('./revision-links-loader', () => ({ loadRevisionLinks: vi.fn(async () => new Map()) }))
vi.mock('@/lib/annotations/repository', () => ({ tallyLiveMarks: vi.fn(async () => new Map()) }))
vi.mock('./reconcile-status', () => ({
  reconcileDocumentStatuses: vi.fn(async (rows: unknown[]) => rows),
  describeBackendIngestState: vi.fn(),
}))

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { canManageOfficeShelf } from '@/lib/authz/organizations'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { requireProjectAccess } from '@/lib/authz/projects'
import type { Document } from '@/lib/db/schema/documents'
import { s3Client } from '@/lib/s3'
import { buildDocumentImageUrl } from '@/lib/images/signed-image-url'
import { makeDocument } from '@/test-utils/db-fixtures'
import { mayReadDocument, memberReader, REVIEWER_READER } from './document-reader'
import {
  findDocumentInOrg,
  findProjectDocumentsByFilenames,
  findProjectDocumentsByNames,
  listDocumentLevelPage,
  type DocumentListRow,
} from './repository'
import { reconcileDocumentStatuses } from './reconcile-status'
import { getDocumentDownload, getDocumentPreview, getDocumentTextPreview, getDocumentThumbnail, streamDocumentImage } from './document-delivery'
import { deleteDocument, renameDocument } from './document-edits'
import { listDocumentsPage, probeProjectDocumentNames, resolveProjectDocumentsByName } from './document-listing'

const personOf = (userId: string, permissions: string[] = []): AuthorizedSession =>
  ({ organizationId: 'org-1', userId, email: `${userId}@example.com`, permissions }) as unknown as AuthorizedSession

const member = personOf('member-1')
const uploader = personOf('uploader-1')
const projectAdmin = personOf('admin-1')
const orgAdmin = personOf('owner-1', [ORG_PERMISSIONS.projectsAdminister])

const quarantined = (overrides: Partial<Document> = {}): Document =>
  makeDocument({
    id: 'doc-q',
    scope: 'project',
    projectId: 'proj-1',
    createdBy: 'uploader-1',
    status: 'quarantined' as const,
    errorMessage: 'quarantined:{"reasons":[{"kind":"iban"}]}',
    ...overrides,
  })

function store(row: Document): void {
  vi.mocked(findDocumentInOrg).mockImplementation(async (_id, _org, reader) => (mayReadDocument(row, reader) ? row : null))
}

type Surface = { name: string; open: (session: AuthorizedSession) => Promise<unknown>; doc: () => Document }

const SURFACES: Surface[] = [
  { name: 'download', open: (session) => getDocumentDownload(session, 'doc-q'), doc: () => quarantined() },
  { name: 'preview', open: (session) => getDocumentPreview(session, 'doc-q'), doc: () => quarantined() },
  {
    name: 'text preview',
    open: (session) => getDocumentTextPreview(session, 'doc-q'),
    doc: () => quarantined({ filename: 'konten.csv', contentType: 'text/csv' }),
  },
  { name: 'thumbnail', open: (session) => getDocumentThumbnail(session, 'doc-q'), doc: () => quarantined() },
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireProjectAccess).mockImplementation(async (session, _projectId, permission) => {
    if (permission === 'project:manage' && session.userId !== 'admin-1') throw new ForbiddenError()
    return { role: 'project-viewer' } as Awaited<ReturnType<typeof requireProjectAccess>>
  })
  vi.mocked(canManageOfficeShelf).mockReturnValue(false)
  vi.mocked(s3Client.send).mockResolvedValue({
    ContentLength: 64,
    Body: { transformToByteArray: async () => new TextEncoder().encode('iban;betrag\n') },
  } as never)
})

describe.each(SURFACES)('the $name of a quarantined project document', ({ open, doc }) => {
  beforeEach(() => {
    store(doc())
  })

  it('does not exist for a project member who did not upload it', async () => {
    await expect(open(member)).rejects.toBeInstanceOf(NotFoundError)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('is served to its uploader', async () => {
    await expect(open(uploader)).resolves.toBeDefined()
  })

  it("is served to the project's admin, who reviews it", async () => {
    await expect(open(projectAdmin)).resolves.toBeDefined()
  })

  it("is served to the organization's admin", async () => {
    await expect(open(orgAdmin)).resolves.toBeDefined()
  })
})

describe('the signed image URL of a document that turns held', () => {
  const imageRow = (overrides: Partial<Document> = {}): Document =>
    quarantined({ filename: 'plan.png', contentType: 'image/png', storageKey: 'org-1/proj-1/doc-q/plan.png', ...overrides })
  const before = imageRow({ status: 'completed' as const, errorMessage: null, screeningOutcome: 'clean' })

  async function mintThenStream(session: AuthorizedSession, atMint: Document, atUse: Document): Promise<Response> {
    store(atMint)
    const { url } = await getDocumentThumbnail(session, 'doc-q')
    if (!url?.startsWith('/api/')) throw new Error(`expected a signed same-origin URL, got ${url}`)
    store(atUse)
    vi.mocked(s3Client.send).mockClear()
    return streamDocumentImage('doc-q', new URL(url, 'https://grid.test').searchParams)
  }

  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-signing-secret')
    vi.mocked(s3Client.send).mockResolvedValue({
      ContentLength: 64,
      Body: { transformToWebStream: () => new ReadableStream() },
    } as never)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('answers 404 to a member whose URL was minted before the verdict', async () => {
    await expect(mintThenStream(member, before, imageRow())).rejects.toBeInstanceOf(NotFoundError)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('answers 404 to the earlier uploader, once somebody else re-uploaded it', async () => {
    const reuploaded = imageRow({ createdBy: 'member-1' })
    await expect(mintThenStream(uploader, before, reuploaded)).rejects.toBeInstanceOf(NotFoundError)
  })

  it('answers 404 to the uploader of the held bytes too', async () => {
    await expect(mintThenStream(uploader, before, imageRow())).rejects.toBeInstanceOf(NotFoundError)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('is not minted for a reviewer on a held row', async () => {
    store(imageRow())
    await expect(getDocumentThumbnail(projectAdmin, 'doc-q')).resolves.toEqual({ url: null })
  })

  it('streams to a member while the row stays screened', async () => {
    const response = await mintThenStream(member, before, before)
    expect(response.status).toBe(200)
  })
})

describe('a document whose screening passed', () => {
  it('is served to every project member as before', async () => {
    store(quarantined({ status: 'completed' as const, errorMessage: null, screeningOutcome: 'clean' }))
    await expect(getDocumentDownload(member, 'doc-q')).resolves.toMatchObject({ filename: 'plan.pdf' })
  })

  it('shows its thumbnail', async () => {
    store(quarantined({ status: 'completed' as const, errorMessage: null, screeningOutcome: 'clean' }))
    await expect(getDocumentThumbnail(member, 'doc-q')).resolves.not.toEqual({ url: null })
  })
})

describe.each([
  ['uploaded', null],
  ['pending', null],
  ['processing', null],
  ['failed', null],
] as const)('a project upload at %s with no verdict', (status, screeningOutcome) => {
  beforeEach(() => {
    store(quarantined({ status, errorMessage: null, screeningOutcome }))
  })

  it('does not exist for a project member who did not upload it', async () => {
    await expect(getDocumentDownload(member, 'doc-q')).rejects.toBeInstanceOf(NotFoundError)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('is served to its uploader and to a reviewer', async () => {
    await expect(getDocumentDownload(uploader, 'doc-q')).resolves.toBeDefined()
    await expect(getDocumentDownload(projectAdmin, 'doc-q')).resolves.toBeDefined()
  })

  it('has no thumbnail, for its uploader and its reviewer too', async () => {
    await expect(getDocumentThumbnail(uploader, 'doc-q')).resolves.toEqual({ url: null })
    await expect(getDocumentThumbnail(projectAdmin, 'doc-q')).resolves.toEqual({ url: null })
  })
})

describe('the write paths on a held document', () => {
  const request = () => new Request('http://localhost/api/documents/doc-q', { method: 'DELETE' })

  beforeEach(() => {
    store(quarantined({ status: 'processing' as const, errorMessage: null, screeningOutcome: null }))
  })

  it('answers 404 to a member who would delete it', async () => {
    await expect(deleteDocument(member, 'doc-q', request())).rejects.toBeInstanceOf(NotFoundError)
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('answers 404 to a member who would rename it', async () => {
    await expect(renameDocument(member, 'doc-q', 'Umbenannt.pdf', request())).rejects.toBeInstanceOf(NotFoundError)
  })
})

describe('a held document re-dispatched with an earlier pass on record', () => {
  it('stays served to members: the verdict on these bytes passed', async () => {
    store(quarantined({ status: 'pending' as const, errorMessage: null, screeningOutcome: 'released' }))
    await expect(getDocumentDownload(member, 'doc-q')).resolves.toBeDefined()
  })
})

describe('a quarantined Büroablage document', () => {
  beforeEach(() => {
    store(quarantined({ scope: 'office_shelf', projectId: null }))
  })

  it('does not exist for an org member who did not upload it', async () => {
    await expect(getDocumentDownload(member, 'doc-q')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('is served to its uploader and to a curator', async () => {
    await expect(getDocumentDownload(uploader, 'doc-q')).resolves.toBeDefined()
    vi.mocked(canManageOfficeShelf).mockReturnValue(true)
    await expect(getDocumentDownload(member, 'doc-q')).resolves.toBeDefined()
  })
})

describe('the project listing and a quarantined document', () => {
  const readerOf = (call: number): unknown => vi.mocked(listDocumentLevelPage).mock.calls[call][2]?.reader

  it('keeps a member to the held files they uploaded themselves', async () => {
    await listDocumentsPage(member, 'proj-1', PAGE)
    await listDocumentsPage(uploader, 'proj-1', PAGE)

    expect(readerOf(0)).toEqual(memberReader('member-1'))
    expect(readerOf(1)).toEqual(memberReader('uploader-1'))
  })

  it('lists every held file to a reviewer', async () => {
    await listDocumentsPage(projectAdmin, 'proj-1', PAGE)
    await listDocumentsPage(orgAdmin, 'proj-1', PAGE)

    expect(readerOf(0)).toEqual(REVIEWER_READER)
    expect(readerOf(1)).toEqual(REVIEWER_READER)
  })

  it('narrows the by-name resolve the same way', async () => {
    await resolveProjectDocumentsByName(member, 'proj-1', ['konten.csv'])
    expect(vi.mocked(findProjectDocumentsByFilenames).mock.calls[0][3]).toMatchObject({ reader: memberReader('member-1') })
  })

  it('narrows the name probe the same way', async () => {
    await probeProjectDocumentNames(member, 'proj-1', ['konten.csv'])
    await probeProjectDocumentNames(projectAdmin, 'proj-1', ['konten.csv'])
    expect(vi.mocked(findProjectDocumentsByNames).mock.calls[0][3]).toMatchObject({ reader: memberReader('member-1') })
    expect(vi.mocked(findProjectDocumentsByNames).mock.calls[1][3]).toMatchObject({ reader: REVIEWER_READER })
  })
})

describe('a verdict that lands during the listing', () => {
  const pendingRow = (id: string, createdBy: string): DocumentListRow => ({
    id,
    filename: `${id}.pdf`,
    projectId: 'proj-1',
    scope: 'project',
    displayName: null,
    fileSize: 64,
    contentType: 'application/pdf',
    status: 'pending' as const,
    authoredBy: 'user',
    publishedVersionId: null,
    lifecycle: 'active',
    collectionName: 'proj_abc',
    folderId: null,
    originPath: null,
    contentHash: null,
    createdBy,
    screeningOutcome: 'clean',
    screenedHash: null,
    createdAt: new Date('2026-10-01T00:00:00Z'),
    updatedAt: new Date('2026-10-01T00:00:00Z'),
    errorMessage: null,
    metadata: null,
  })

  beforeEach(() => {
    vi.mocked(listDocumentLevelPage).mockResolvedValue({
      rows: [pendingRow('mine', 'member-1'), pendingRow('theirs', 'uploader-1')],
      nextCursor: null,
    })
    vi.mocked(reconcileDocumentStatuses).mockImplementation(async (rows) =>
      rows.map((row) => ({ ...row, status: 'quarantined' as const, screeningOutcome: 'quarantined' }))
    )
  })

  it("leaves somebody else's out for a member, and keeps their own", async () => {
    const { documents } = await listDocumentsPage(member, 'proj-1', PAGE)
    expect(documents.map((doc) => doc.id)).toEqual(['mine'])
    expect(documents[0]).not.toHaveProperty('createdBy')
  })

  it('keeps both for a reviewer', async () => {
    const { documents } = await listDocumentsPage(projectAdmin, 'proj-1', PAGE)
    expect(documents.map((doc) => doc.id)).toEqual(['mine', 'theirs'])
  })
})

describe('the preview of a held image', () => {
  const heldImage = () =>
    quarantined({ status: 'processing' as const, errorMessage: null, filename: 'scan.png', contentType: 'image/png' })

  beforeEach(() => {
    vi.stubEnv('INTERNAL_API_TOKEN', 'test-secret')
  })

  it.each([
    ['its uploader', uploader],
    ["the project's admin, who reviews it", projectAdmin],
  ])('gives %s the presigned file and no optimizer URL', async (_label, session) => {
    store(heldImage())
    await expect(getDocumentPreview(session, 'doc-q')).resolves.toMatchObject({
      url: 'https://seaweedfs.internal/presigned',
      imageUrl: null,
    })
  })

  it('is not served through a signed URL, whoever it names', async () => {
    store(heldImage())
    for (const person of ['uploader-1', 'admin-1']) {
      const signed = new URL(buildDocumentImageUrl('org-1', person, 'doc-q', 'original')!, 'https://grid.test')
      await expect(streamDocumentImage('doc-q', signed.searchParams)).rejects.toBeInstanceOf(NotFoundError)
    }
    expect(s3Client.send).not.toHaveBeenCalled()
  })

  it('once screened, is previewed through the optimizer URL that then serves it', async () => {
    store(heldImage())
    vi.mocked(findDocumentInOrg).mockImplementation(async (_id, _org, reader) => {
      const screened = quarantined({
        status: 'completed' as const,
        errorMessage: null,
        screeningOutcome: 'clean',
        filename: 'scan.png',
        contentType: 'image/png',
      })
      return mayReadDocument(screened, reader) ? screened : null
    })
    const preview = await getDocumentPreview(member, 'doc-q')
    expect(preview.imageUrl).toBeTruthy()
    vi.mocked(s3Client.send).mockResolvedValue({
      ContentLength: 64,
      Body: { transformToWebStream: () => new ReadableStream() },
    } as never)
    const response = await streamDocumentImage('doc-q', new URL(preview.imageUrl!, 'https://grid.test').searchParams)
    expect(response.status).toBe(200)
  })
})
