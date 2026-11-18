import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn().mockResolvedValue(undefined) },
  signingS3Client: { send: vi.fn().mockResolvedValue(undefined) },
  bucketAdminS3Client: { send: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://seaweedfs.internal/presigned'),
}))

vi.mock('@/lib/backend-proxy', () => ({
  getBackendUrl: vi.fn().mockReturnValue('http://backend:8000'),
}))

vi.mock('./repository', () => ({
  markDocumentProcessing: vi.fn().mockResolvedValue(undefined),
  setDocumentBackgroundJob: vi.fn().mockResolvedValue(undefined),
  markDocumentIngestFailed: vi.fn().mockResolvedValue(undefined),
  setDocumentIngestJob: vi.fn().mockResolvedValue(undefined),
  markDocumentNotIndexed: vi.fn().mockResolvedValue(undefined),
  findDocumentInOrg: vi.fn(),
  findFolderPathInProject: vi.fn(),
  findStorageKeyByCollectionAndFilename: vi.fn(),
  listProjectDocuments: vi.fn(),
  deleteProjectDocument: vi.fn(),
}))

vi.mock('@/lib/organizations/service', () => ({ getOrgSettings: vi.fn() }))

vi.mock('@/lib/base-knowledge/text-guard', async () => ({
  isTextHeld: vi.fn(async () => false),
  copyMarkForIngest: vi.fn(async () => null),
  licenceMarkFields: (await vi.importActual<typeof import('@/lib/base-knowledge/office/text-use')>('@/lib/base-knowledge/office/text-use')).licenceMarkFields,
}))

vi.mock('./rendition', async (importOriginal) => {
  const { renditionModuleMock } = await import('@/test-utils/rendition-module')
  return renditionModuleMock(await importOriginal(), false)
})

import { invalidateCached } from '@/lib/cache'
import { getOrgSettings } from '@/lib/organizations/service'
import { findDocumentInOrg, markDocumentIngestFailed } from './repository'
import { makeDocument } from '@/test-utils/db-fixtures'
import { dispatchDocument, type DispatchDocumentInput } from './document-dispatch'
import { INGEST_DISPATCH_FAILED_MESSAGE } from './ingest-dispatch'

const input = (filename: string): DispatchDocumentInput => ({
  organizationId: 'org-1',
  projectId: 'proj-1',
  documentId: 'doc-1',
  filename,
  storageKey: `org/org-1/project/proj-1/doc/doc-1/${filename}`,
  storageBucket: 'test-bucket',
  collectionName: 'proj_abc',
})

let fetchSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ job_id: 'job-1' }) })
  vi.stubGlobal('fetch', fetchSpy)
  vi.mocked(findDocumentInOrg).mockResolvedValue(makeDocument({ authoredBy: 'user' }))
  vi.mocked(getOrgSettings).mockResolvedValue({ displayName: null, defaultLocale: 'de', homeCountry: null, settings: {} })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('dispatchDocument — upload screening', () => {
  const sentBody = (): Record<string, unknown> =>
    JSON.parse(String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body)) as Record<string, unknown>

  beforeEach(async () => {
    await invalidateCached('upload-screening:org-1')
  })

  it("sends the suggested content rules for an office that never saved a policy", async () => {
    await dispatchDocument(input('Baubeschreibung.pdf'))
    const screening = sentBody().screening as { content_terms: string[]; detectors: string[] }
    expect(screening.detectors).toEqual(['iban', 'at_svnr', 'credit_card', 'de_svnr', 'de_tax_id'])
    expect(screening.content_terms).toContain('Gehaltsabrechnung')
  })

  it("sends the office's own rules once it saved them", async () => {
    vi.mocked(getOrgSettings).mockResolvedValue({
      displayName: null,
      defaultLocale: 'de',
      homeCountry: null,
      settings: {
        uploadScreening: {
          enabled: true,
          nameTerms: [],
          nameExceptions: [],
          contentTerms: ['Projektkalkulation'],
          detectors: ['iban'],
        },
      },
    })
    await dispatchDocument(input('Baubeschreibung.pdf'))
    expect(sentBody().screening).toEqual({ content_terms: ['Projektkalkulation'], detectors: ['iban'] })
  })

  it('sends no rules when the office switched screening off', async () => {
    vi.mocked(getOrgSettings).mockResolvedValue({
      displayName: null,
      defaultLocale: 'de',
      homeCountry: null,
      settings: {
        uploadScreening: { enabled: false, nameTerms: [], nameExceptions: [], contentTerms: ['x y'], detectors: [] },
      },
    })
    await dispatchDocument(input('Baubeschreibung.pdf'))
    expect(sentBody().screening).toBeNull()
  })

  it('skips screening only for the exact bytes a reviewer released', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ authoredBy: 'user', contentHash: 'sha256:aaa', screeningReleasedHash: 'sha256:aaa' })
    )
    await dispatchDocument(input('Honorar.pdf'))
    expect(sentBody().screening).toBeNull()
  })

  it('screens a re-upload under a released id, because its bytes are new', async () => {
    vi.mocked(findDocumentInOrg).mockResolvedValue(
      makeDocument({ authoredBy: 'user', contentHash: 'sha256:bbb', screeningReleasedHash: 'sha256:aaa' })
    )
    await dispatchDocument(input('Honorar.pdf'))
    expect(sentBody().screening).not.toBeNull()
  })

  it('fails closed when the policy cannot be read: sends nothing, and the row offers a retry', async () => {
    vi.mocked(getOrgSettings).mockRejectedValue(new Error('db down'))
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const result = await dispatchDocument(input('Baubeschreibung.pdf'))
    expect(result).toEqual({ jobId: null, status: 'failed' })
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(markDocumentIngestFailed).toHaveBeenCalledWith('doc-1', 'org-1', INGEST_DISPATCH_FAILED_MESSAGE, expect.objectContaining({ ingestJobId: null }))
    errorLog.mockRestore()
  })
})
