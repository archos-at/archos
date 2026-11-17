/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteObjectCommand } from '@aws-sdk/client-s3'

vi.mock('server-only', () => ({}))

const send = vi.fn()
vi.mock('@/lib/s3', () => ({
  s3Client: { send: (...args: unknown[]) => send(...args) },
}))

const admitDocumentWithinQuota = vi.fn()
const admitReplacementWithinQuota = vi.fn()
vi.mock('./service', () => ({
  admitDocumentWithinQuota: (...args: unknown[]) => admitDocumentWithinQuota(...args),
  admitReplacementWithinQuota: (...args: unknown[]) => admitReplacementWithinQuota(...args),
}))

import { InsufficientStorageError } from '@/lib/api/errors'
import { admitOrDiscard, admitReplacementOrDiscard } from './admission'
import type { NewDocument } from '@/lib/db/schema/documents'

const ROW = {
  id: 'doc-1',
  organizationId: 'org-1',
  storageKey: 'org/org-1/project/p1/doc-1/report.pdf',
  fileSize: 5_000,
} as unknown as NewDocument

const BUCKET = 'grid-org-org-1-abc'

describe('admitOrDiscard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    send.mockResolvedValue({})
  })

  it('keeps the object when the row is admitted', async () => {
    admitDocumentWithinQuota.mockResolvedValue(undefined)
    await admitOrDiscard(BUCKET, ROW.storageKey, ROW)
    expect(admitDocumentWithinQuota).toHaveBeenCalledWith(ROW)
    expect(send).not.toHaveBeenCalled()
  })

  it('deletes the object it just wrote when admission refuses', async () => {
    admitDocumentWithinQuota.mockRejectedValue(new InsufficientStorageError())

    await expect(admitOrDiscard(BUCKET, ROW.storageKey, ROW)).rejects.toBeInstanceOf(
      InsufficientStorageError,
    )

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0][0]
    expect(command).toBeInstanceOf(DeleteObjectCommand)
    expect(command.input).toEqual({ Bucket: BUCKET, Key: ROW.storageKey })
  })

  it('re-throws the refusal, so the caller reports the quota and not a 500', async () => {
    const refusal = new InsufficientStorageError('no room', {
      quotaBytes: 10,
      usedBytes: 10,
      requestedBytes: 5,
    })
    admitDocumentWithinQuota.mockRejectedValue(refusal)
    await expect(admitOrDiscard(BUCKET, ROW.storageKey, ROW)).rejects.toBe(refusal)
  })

  it('also cleans up when the insert fails for a reason other than the quota', async () => {
    admitDocumentWithinQuota.mockRejectedValue(new Error('deadlock detected'))
    await expect(admitOrDiscard(BUCKET, ROW.storageKey, ROW)).rejects.toThrow('deadlock detected')
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('still reports the original failure when the cleanup itself fails', async () => {
    const refusal = new InsufficientStorageError()
    admitDocumentWithinQuota.mockRejectedValue(refusal)
    send.mockRejectedValue(new Error('AccessDenied'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(admitOrDiscard(BUCKET, ROW.storageKey, ROW)).rejects.toBe(refusal)
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })
})


describe('admitReplacementOrDiscard', () => {
  const NEXT = {
    storageKey: 'org/org-1/project/p1/doc-1/report.pdf',
    storageBucket: BUCKET,
    fileSize: 5_000,
    contentType: 'application/pdf',
    contentHash: 'sha256:beef',
    folderId: null,
    createdBy: 'user-1',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    admitReplacementWithinQuota.mockResolvedValue(undefined)
    send.mockResolvedValue({})
  })

  it('leaves the object alone when the replacement is admitted', async () => {
    await admitReplacementOrDiscard(BUCKET, NEXT.storageKey, 'org-1', 'doc-1', NEXT)

    expect(admitReplacementWithinQuota).toHaveBeenCalledWith('org-1', 'doc-1', NEXT)
    expect(send).not.toHaveBeenCalled()
  })

  it('discards the NEW object when the quota refuses, and rethrows', async () => {
    admitReplacementWithinQuota.mockRejectedValue(
      new InsufficientStorageError('full', { quotaBytes: 1, usedBytes: 1, requestedBytes: 1 })
    )

    await expect(
      admitReplacementOrDiscard(BUCKET, NEXT.storageKey, 'org-1', 'doc-1', NEXT)
    ).rejects.toBeInstanceOf(InsufficientStorageError)

    expect(send).toHaveBeenCalledTimes(1)
    const command = send.mock.calls[0]?.[0]
    expect(command).toBeInstanceOf(DeleteObjectCommand)
    expect((command as DeleteObjectCommand).input).toMatchObject({
      Bucket: BUCKET,
      Key: NEXT.storageKey,
    })
  })

  it('still surfaces the refusal when the cleanup itself fails', async () => {
    admitReplacementWithinQuota.mockRejectedValue(new Error('nope'))
    send.mockRejectedValue(new Error('object store down'))

    await expect(
      admitReplacementOrDiscard(BUCKET, NEXT.storageKey, 'org-1', 'doc-1', NEXT)
    ).rejects.toThrow('nope')
  })
})
