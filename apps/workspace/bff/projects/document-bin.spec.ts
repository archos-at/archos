/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const policy = vi.hoisted(() => ({ assertMayBinDocument: vi.fn(), createHolder: vi.fn() }))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/access', () => ({ findDocumentForSession: vi.fn() }))
vi.mock('@/lib/compliance/holds', () => ({ assertNoActiveHold: vi.fn() }))
vi.mock('@/lib/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: (_scope: unknown, fn: () => unknown) => fn() }))
vi.mock('@/lib/documents/move-to-folder', () => ({ moveDocumentToFolder: vi.fn() }))
vi.mock('@/lib/documents/shelf-live', () => ({ publishShelfChanged: vi.fn() }))
vi.mock('./bin-shelf', () => ({ binPolicyOf: vi.fn(() => policy) }))
vi.mock('./cleanup-repository', () => ({ deleteEmptyCreatedFolder: vi.fn().mockResolvedValue(true) }))
vi.mock('./folder-bin', () => ({ moveFolderToBin: vi.fn(), restoreFolderFromBin: vi.fn() }))
vi.mock('./folder-bin-repository', () => ({ findFolderInOrg: vi.fn(), findActiveBinEntry: vi.fn() }))

import { ConflictError, ForbiddenError } from '@/lib/api/errors'
import { assertNoActiveHold } from '@/lib/compliance/holds'
import { LEGAL_HOLD_MESSAGE, LEGAL_HOLD_REASON } from '@/lib/compliance/legal-hold-codes'
import type { AuthorizedSession } from '@/lib/auth/types'
import { findDocumentForSession } from '@/lib/documents/access'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { binPolicyOf } from './bin-shelf'
import { deleteEmptyCreatedFolder } from './cleanup-repository'
import { moveDocumentToBin, restoreDocumentFromBin } from './document-bin'
import { moveFolderToBin, restoreFolderFromBin } from './folder-bin'
import { findActiveBinEntry, findFolderInOrg } from './folder-bin-repository'

const session = { userId: 'u1', organizationId: 'org-1' } as AuthorizedSession
const PROJECT = { kind: 'project', projectId: 'p1' } as const
const OFFICE = { kind: 'office_shelf' } as const
const doc = { id: 'd1', scope: 'project', projectId: 'p1', ownerUserId: null, folderId: 'f-plans', filename: 'Plan.pdf', displayName: null }
const officeDoc = { ...doc, scope: 'office_shelf', projectId: null, folderId: 'f-library', filename: 'Leitfaden.pdf' }
const holder = { id: 'h1', parentId: 'f-plans', deletedAt: new Date(), purgedAt: null, binRootId: 'h1' }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findDocumentForSession).mockResolvedValue(doc as never)
  policy.assertMayBinDocument.mockResolvedValue(undefined)
  policy.createHolder.mockResolvedValue({ ok: true, folder: { id: 'h1' } })
  vi.mocked(moveDocumentToFolder).mockResolvedValue({ ok: true, document: { id: 'd1', folderId: 'h1' } })
  vi.mocked(deleteEmptyCreatedFolder).mockResolvedValue(true)
})

describe('moveDocumentToBin', () => {
  it('bins a holder named after the document, holding exactly it', async () => {
    vi.mocked(findFolderInOrg).mockResolvedValue({ id: 'f-plans', deletedAt: null } as never)
    vi.mocked(moveFolderToBin).mockResolvedValue({ documentsBinned: 1, foldersBinned: 1, purgeAfter: new Date('2026-11-05T00:00:00Z') })

    const result = await moveDocumentToBin(session, 'd1')

    expect(binPolicyOf).toHaveBeenCalledWith(PROJECT)
    expect(policy.createHolder).toHaveBeenCalledWith(session, 'f-plans', 'Plan.pdf')
    expect(moveFolderToBin).toHaveBeenCalledWith(session, { shelf: PROJECT, folderId: 'h1' }, undefined, {
      onlyDocuments: ['d1'],
      documentId: 'd1',
    })
    expect(result).toEqual({ documentId: 'd1', binEntryId: 'h1', purgeAfter: '2026-11-05T00:00:00.000Z' })
  })

  it('puts the document back and removes the holder when binning fails', async () => {
    vi.mocked(findFolderInOrg).mockResolvedValue({ id: 'f-plans', deletedAt: null } as never)
    vi.mocked(moveFolderToBin).mockRejectedValue(new Error('index did not confirm'))

    await expect(moveDocumentToBin(session, 'd1')).rejects.toThrow('index did not confirm')

    expect(moveDocumentToFolder).toHaveBeenLastCalledWith({ documentId: 'd1', folderId: 'f-plans', expectedFolderId: 'h1' }, session)
    expect(deleteEmptyCreatedFolder).toHaveBeenCalledWith('org-1', PROJECT, 'h1')
  })

  it('refuses a document under a legal hold before it touches anything', async () => {
    vi.mocked(assertNoActiveHold).mockRejectedValueOnce(
      new ConflictError(LEGAL_HOLD_MESSAGE, { reason: LEGAL_HOLD_REASON, entityType: 'document' })
    )

    await expect(moveDocumentToBin(session, 'd1')).rejects.toMatchObject({ status: 409, details: { reason: LEGAL_HOLD_REASON } })

    expect(assertNoActiveHold).toHaveBeenCalledWith('org-1', 'document', 'd1')
    expect(policy.createHolder).not.toHaveBeenCalled()
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
    expect(moveFolderToBin).not.toHaveBeenCalled()
  })

  it('bins an office shelf document into the office shelf’s own bin', async () => {
    vi.mocked(findDocumentForSession).mockResolvedValue(officeDoc as never)
    vi.mocked(findFolderInOrg).mockResolvedValue({ id: 'f-library', deletedAt: null } as never)
    vi.mocked(moveFolderToBin).mockResolvedValue({ documentsBinned: 1, foldersBinned: 1, purgeAfter: new Date('2026-11-05T00:00:00Z') })

    await moveDocumentToBin(session, 'd1')

    expect(binPolicyOf).toHaveBeenCalledWith(OFFICE)
    expect(policy.createHolder).toHaveBeenCalledWith(session, 'f-library', 'Leitfaden.pdf')
    expect(moveFolderToBin).toHaveBeenCalledWith(session, { shelf: OFFICE, folderId: 'h1' }, undefined, expect.anything())
  })

  it('stops at the shelf’s own refusal (a curator’s right, a norm) before it makes a holder', async () => {
    vi.mocked(findDocumentForSession).mockResolvedValue(officeDoc as never)
    policy.assertMayBinDocument.mockRejectedValueOnce(new ForbiddenError())

    await expect(moveDocumentToBin(session, 'd1')).rejects.toBeInstanceOf(ForbiddenError)
    expect(policy.createHolder).not.toHaveBeenCalled()
  })

  it('refuses a document of a person’s own shelf, which has no bin (ADR-0193)', async () => {
    vi.mocked(findDocumentForSession).mockResolvedValue({ ...doc, scope: 'personal', projectId: null, ownerUserId: 'u1' } as never)
    await expect(moveDocumentToBin(session, 'd1')).rejects.toMatchObject({ status: 409, details: { reason: 'document-has-no-bin' } })
    expect(policy.createHolder).not.toHaveBeenCalled()
  })
})

describe('restoreDocumentFromBin', () => {
  beforeEach(() => {
    vi.mocked(findDocumentForSession).mockResolvedValue({ ...doc, folderId: 'h1' } as never)
    vi.mocked(findFolderInOrg).mockResolvedValue(holder as never)
  })

  it('restores the holder, files the document back and removes the holder', async () => {
    vi.mocked(findActiveBinEntry).mockResolvedValue({ payload: { documentId: 'd1' } } as never)
    vi.mocked(restoreFolderFromBin).mockResolvedValue({ restoredTo: 'original', folders: 1, documents: 1 })

    const result = await restoreDocumentFromBin(session, 'd1')

    expect(restoreFolderFromBin).toHaveBeenCalledWith(session, { shelf: PROJECT, folderId: 'h1' }, undefined)
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: 'd1', folderId: 'f-plans', expectedFolderId: 'h1' }, session)
    expect(deleteEmptyCreatedFolder).toHaveBeenCalledWith('org-1', PROJECT, 'h1')
    expect(result).toEqual({ documentId: 'd1', folderId: 'f-plans', restoredTo: 'original' })
  })

  it('sends a document that went with its folder to the folder restore', async () => {
    vi.mocked(findActiveBinEntry).mockResolvedValue({ payload: {} } as never)
    await expect(restoreDocumentFromBin(session, 'd1')).rejects.toMatchObject({
      status: 409,
      details: { reason: 'binned-with-folder', folderId: 'h1' },
    })
    expect(restoreFolderFromBin).not.toHaveBeenCalled()
  })
})
