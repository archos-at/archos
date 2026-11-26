import { afterEach, describe, expect, it, vi } from 'vitest'
import { PutObjectCommand } from '@aws-sdk/client-s3'

vi.mock('@/lib/s3', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/s3')>()),
  s3Client: { send: vi.fn() },
  signingS3Client: { send: vi.fn() },
  bucketAdminS3Client: { send: vi.fn() },
}))

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn().mockResolvedValue('https://seaweedfs.internal/presigned-put'),
}))

vi.mock('@/lib/storage/bucket', () => ({
  resolveDocumentBucket: (bucket: string | null) => bucket ?? 'grid-documents',
  ensureTenantBucketChecked: vi.fn(),
}))

vi.mock('./repository', () => ({
  findStorageKeyByIdAndCollection: vi.fn(),
  findStorageKeysByCollectionAndFilename: vi.fn(),
  findReadableStorageKeyById: vi.fn(),
}))

import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { MAX_STORED_IMAGES_PER_DOCUMENT } from '@/lib/s3'
import { findReadableStorageKeyById, findStorageKeyByIdAndCollection, findStorageKeysByCollectionAndFilename } from './repository'
import {
  findDocumentImageStorageKey,
  findDocumentImageStorageKeyById,
  findDocumentStorageKey,
  findDocumentStorageKeyById,
  presignDocumentImageUpload,
} from './document-storage-keys'

const DOC_ID = '4f9c1d2e-3b4a-4c5d-8e6f-7a8b9c0d1e2f'
const row = { id: 'd1', storageKey: 'org/o1/project/p1/doc/d1/plan.pdf', storageBucket: 'grid-org-o1-abcdef123456', versionId: null }

afterEach(() => {
  vi.clearAllMocks()
})

describe('presignDocumentImageUpload', () => {
  it('signs a PUT for <doc dir>/_img/<index>.jpg in the document bucket and returns the key', async () => {
    vi.mocked(findStorageKeyByIdAndCollection).mockResolvedValue(row)

    const slot = await presignDocumentImageUpload(DOC_ID, 'proj_1', 2, 'org_1')

    expect(slot).toEqual({
      uploadUrl: 'https://seaweedfs.internal/presigned-put',
      storageKey: 'org/o1/project/p1/doc/d1/_img/2.jpg',
    })
    expect(vi.mocked(findStorageKeyByIdAndCollection).mock.calls[0]).toEqual([DOC_ID, 'proj_1', 'org_1'])
    const [, command] = vi.mocked(getSignedUrl).mock.calls[0]
    expect(command).toBeInstanceOf(PutObjectCommand)
    expect((command as PutObjectCommand).input).toEqual({
      Bucket: 'grid-org-o1-abcdef123456',
      Key: 'org/o1/project/p1/doc/d1/_img/2.jpg',
      ContentType: 'image/jpeg',
    })
  })

  it('issues nothing for an unknown document', async () => {
    vi.mocked(findStorageKeyByIdAndCollection).mockResolvedValue(null)

    await expect(presignDocumentImageUpload(DOC_ID, 'proj_1', 0)).resolves.toBeNull()
    expect(getSignedUrl).not.toHaveBeenCalled()
  })

  it('issues nothing at or past the per-document ceiling', async () => {
    vi.mocked(findStorageKeyByIdAndCollection).mockResolvedValue(row)

    await expect(presignDocumentImageUpload(DOC_ID, 'proj_1', MAX_STORED_IMAGES_PER_DOCUMENT)).resolves.toBeNull()
    expect(getSignedUrl).not.toHaveBeenCalled()
  })
})

describe('findDocumentImageStorageKey', () => {
  it('derives the raster key from the owning row, never from the caller', async () => {
    vi.mocked(findStorageKeysByCollectionAndFilename).mockResolvedValue([{ ...row, contentType: 'application/pdf' }])

    await expect(findDocumentImageStorageKey('proj_1', 'plan.pdf', 5)).resolves.toEqual({
      storageKey: 'org/o1/project/p1/doc/d1/_img/5.jpg',
      storageBucket: 'grid-org-o1-abcdef123456',
      contentType: 'image/jpeg',
    })
  })

  it('answers null for an unknown pair or an index past the ceiling', async () => {
    vi.mocked(findStorageKeysByCollectionAndFilename).mockResolvedValue([])
    await expect(findDocumentImageStorageKey('proj_1', 'plan.pdf', 0)).resolves.toBeNull()

    vi.mocked(findStorageKeysByCollectionAndFilename).mockResolvedValue([{ ...row, contentType: 'application/pdf' }])
    await expect(findDocumentImageStorageKey('proj_1', 'plan.pdf', MAX_STORED_IMAGES_PER_DOCUMENT)).resolves.toBeNull()
  })

  it('derives the raster of the document the id names', async () => {
    vi.mocked(findReadableStorageKeyById).mockResolvedValue({ ...row, id: DOC_ID, contentType: 'application/pdf' })

    await expect(findDocumentImageStorageKeyById('proj_1', DOC_ID, 1)).resolves.toMatchObject({
      storageKey: 'org/o1/project/p1/doc/d1/_img/1.jpg',
    })
    expect(findReadableStorageKeyById).toHaveBeenCalledWith(DOC_ID, 'proj_1', undefined)
    expect(findStorageKeysByCollectionAndFilename).not.toHaveBeenCalled()
  })
})

describe('findDocumentStorageKey', () => {
  const entwurf = { ...row, id: 'doc-entwurf', storageKey: 'org/o1/project/p1/doc/doc-entwurf/Plan.pdf', contentType: 'application/pdf' }
  const einreichung = { ...row, id: 'doc-einreichung', storageKey: 'org/o1/project/p1/doc/doc-einreichung/Plan.pdf', contentType: 'application/pdf' }

  it('answers the one document a name names', async () => {
    vi.mocked(findStorageKeysByCollectionAndFilename).mockResolvedValue([entwurf])
    await expect(findDocumentStorageKey('proj_1', 'Plan.pdf')).resolves.toEqual(entwurf)
  })

  it('refuses a name two live documents carry as ambiguous, rather than answering the newest', async () => {
    vi.mocked(findStorageKeysByCollectionAndFilename).mockResolvedValue([einreichung, entwurf])
    await expect(findDocumentStorageKey('proj_1', 'Plan.pdf')).rejects.toMatchObject({
      status: 409,
      details: { reason: 'ambiguous_name' },
    })
  })

  it('refuses the same name for a stored raster too', async () => {
    vi.mocked(findStorageKeysByCollectionAndFilename).mockResolvedValue([einreichung, entwurf])
    await expect(findDocumentImageStorageKey('proj_1', 'Plan.pdf', 0)).rejects.toMatchObject({ status: 409 })
  })

  it('answers each of two same-named documents by its id', async () => {
    vi.mocked(findReadableStorageKeyById).mockImplementation(async (id) => [entwurf, einreichung].find((doc) => doc.id === id) ?? null)
    await expect(findDocumentStorageKeyById('proj_1', 'doc-entwurf')).resolves.toEqual(entwurf)
    await expect(findDocumentStorageKeyById('proj_1', 'doc-einreichung')).resolves.toEqual(einreichung)
  })
})
