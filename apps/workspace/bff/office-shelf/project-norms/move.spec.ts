/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('@/lib/documents/stored-copy', () => ({
  storedFileOf: vi.fn(async (_document: unknown, name: string) => new File([new Uint8Array([1])], name)),
}))
vi.mock('@/lib/documents/shelf-live', () => ({ publishShelfChanged: vi.fn() }))
vi.mock('@/lib/compliance/holds', () => ({ assertNoActiveHold: vi.fn(async () => undefined) }))
vi.mock('@/lib/projects/document-bin', () => ({ moveDocumentToBin: vi.fn(async () => ({})) }))
vi.mock('@/lib/base-knowledge/office/service', () => ({
  uploadBaseKnowledge: vi.fn(),
  confirmBaseKnowledge: vi.fn(),
  removeBaseKnowledge: vi.fn(async () => ({ removed: true })),
}))
vi.mock('@/lib/base-knowledge/office/new-edition', () => ({ addBaseKnowledgeEdition: vi.fn() }))
vi.mock('./held-works', () => ({ heldWorks: vi.fn(async () => new Map()) }))
vi.mock('./repository', () => ({ insertReference: vi.fn(async () => ({ id: 'reference-1' })) }))

import { ApiError, ConflictError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { addBaseKnowledgeEdition } from '@/lib/base-knowledge/office/new-edition'
import { confirmBaseKnowledge, removeBaseKnowledge, uploadBaseKnowledge } from '@/lib/base-knowledge/office/service'
import type { BaseKnowledgeEntry } from '@/lib/base-knowledge/wire'
import type { Document } from '@/lib/db/schema/documents'
import { getAccessibleDocument } from '@/lib/documents/access'
import { moveDocumentToBin } from '@/lib/projects/document-bin'
import { heldWorks } from './held-works'
import { applyOfficeShelfNorm, moveNormsToOfficeShelf, moveNormToOfficeShelf } from './move'
import { workKey, type HeldEdition } from './placement'
import { insertReference } from './repository'

const MANAGER: AuthorizedSession = {
  userId: 'user-1',
  email: 'anna@example.com',
  name: 'Anna Berger',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'member',
  permissions: [ORG_PERMISSIONS.officeShelfManage],
  featureFlags: [],
}
const MEMBER: AuthorizedSession = { ...MANAGER, permissions: [] }
const REQUEST = new Request('http://localhost/api/projects/project-1/norms', { method: 'POST' })

function projectDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-1',
    organizationId: 'org-1',
    projectId: 'project-1',
    scope: 'project',
    folderId: 'folder-normen',
    filename: 'OENORM_B_1600_2023-02-01.pdf',
    displayName: null,
    status: 'completed',
    authoredBy: 'user',
    screeningOutcome: 'clean',
    contentHash: 'hash-1',
    screenedHash: 'hash-1',
    storageKey: 'org-1/project-1/doc-1.pdf',
    storageBucket: null,
    contentType: 'application/pdf',
    ...overrides,
  } as unknown as Document
}

function entry(overrides: Partial<BaseKnowledgeEntry> = {}): BaseKnowledgeEntry {
  return { id: 'edition-new', documentId: 'office-doc-1', status: 'proposed', ...overrides } as BaseKnowledgeEntry
}

function heldEdition(editionLabel: string, contentHash: string): HeldEdition {
  return {
    entry: {
      editionId: 'edition-held',
      documentId: 'office-doc-held',
      createdAt: new Date('2026-01-01'),
      values: {
        kind: 'technical_standard',
        title: 'Barrierefreies Bauen',
        designation: 'ÖNORM B 1600:2017',
        editionLabel,
        issuedOn: null,
        inForceFrom: null,
        inForceTo: null,
        territoryIds: [],
        issuer: null,
        addressees: [],
        licenceClass: 'public_open',
      },
    },
    contentHash,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getAccessibleDocument).mockResolvedValue(projectDocument())
  vi.mocked(heldWorks).mockResolvedValue(new Map())
  vi.mocked(uploadBaseKnowledge).mockResolvedValue(entry())
  vi.mocked(addBaseKnowledgeEdition).mockResolvedValue(entry({ id: 'edition-added', documentId: 'office-doc-2' }))
  vi.mocked(moveDocumentToBin).mockResolvedValue({} as Awaited<ReturnType<typeof moveDocumentToBin>>)
})

describe('a project norm moves into the office shelf', () => {
  it('copies a norm the office shelf lacks, bins the project file and leaves a reference where it lay', async () => {
    const placed = await moveNormToOfficeShelf(MANAGER, 'project-1', { documentId: 'doc-1' }, REQUEST)

    expect(getAccessibleDocument).toHaveBeenCalledWith(MANAGER, 'doc-1', 'write')
    expect(uploadBaseKnowledge).toHaveBeenCalledWith(MANAGER, expect.any(File), REQUEST, {})
    expect(vi.mocked(uploadBaseKnowledge).mock.calls[0][1].name).toBe('OENORM_B_1600_2023-02-01.pdf')
    expect(moveDocumentToBin).toHaveBeenCalledWith(MANAGER, 'doc-1', REQUEST)
    expect(insertReference).toHaveBeenCalledWith({
      organizationId: 'org-1',
      projectId: 'project-1',
      folderId: 'folder-normen',
      sourceDocumentId: 'doc-1',
      officeDocumentId: 'office-doc-1',
      fileName: 'OENORM_B_1600_2023-02-01.pdf',
      placedAs: 'moved',
      createdBy: 'user-1',
    })
    expect(placed).toMatchObject({ outcome: 'moved', officeDocumentId: 'office-doc-1', entryId: 'edition-new', referenceId: 'reference-1' })
    expect(confirmBaseKnowledge).not.toHaveBeenCalled()
  })

  it('refuses without the right to manage the office shelf, before anything is copied or binned', async () => {
    await expect(moveNormToOfficeShelf(MEMBER, 'project-1', { documentId: 'doc-1' }, REQUEST)).rejects.toMatchObject({ status: 403 })
    expect(uploadBaseKnowledge).not.toHaveBeenCalled()
    expect(moveDocumentToBin).not.toHaveBeenCalled()
  })

  it('refuses a file of another project, and one still being read', async () => {
    await expect(moveNormToOfficeShelf(MANAGER, 'project-2', { documentId: 'doc-1' }, REQUEST)).rejects.toMatchObject({ status: 404 })
    vi.mocked(getAccessibleDocument).mockResolvedValue(projectDocument({ status: 'processing' }))
    await expect(moveNormToOfficeShelf(MANAGER, 'project-1', { documentId: 'doc-1' }, REQUEST)).rejects.toBeInstanceOf(ConflictError)
    expect(uploadBaseKnowledge).not.toHaveBeenCalled()
  })

  it('attaches a norm whose work the office shelf holds as a new edition of it', async () => {
    vi.mocked(heldWorks).mockResolvedValue(new Map([[workKey('ÖNORM B 1600')!, [heldEdition('2017-04-15', 'hash-old')]]]))
    const placed = await moveNormToOfficeShelf(MANAGER, 'project-1', { documentId: 'doc-1' }, REQUEST)
    expect(addBaseKnowledgeEdition).toHaveBeenCalledWith(MANAGER, 'edition-held', expect.any(File), REQUEST)
    expect(uploadBaseKnowledge).not.toHaveBeenCalled()
    expect(vi.mocked(insertReference).mock.calls[0][0]).toMatchObject({ placedAs: 'edition', officeDocumentId: 'office-doc-2' })
    expect(placed.outcome).toBe('edition')
  })

  it('drops a duplicate of a held edition: nothing is copied, the file goes to the bin and the reference names the held copy', async () => {
    vi.mocked(heldWorks).mockResolvedValue(new Map([[workKey('ÖNORM B 1600')!, [heldEdition('2023-02-01', 'hash-other')]]]))
    const placed = await moveNormToOfficeShelf(MANAGER, 'project-1', { documentId: 'doc-1' }, REQUEST)
    expect(uploadBaseKnowledge).not.toHaveBeenCalled()
    expect(addBaseKnowledgeEdition).not.toHaveBeenCalled()
    expect(moveDocumentToBin).toHaveBeenCalledWith(MANAGER, 'doc-1', REQUEST)
    expect(vi.mocked(insertReference).mock.calls[0][0]).toMatchObject({ placedAs: 'duplicate', officeDocumentId: 'office-doc-held' })
    expect(placed).toMatchObject({ outcome: 'duplicate', officeDocumentId: 'office-doc-held' })
  })

  it('takes the copy out of the office shelf again when the project file cannot go to the bin', async () => {
    vi.mocked(moveDocumentToBin).mockRejectedValue(new ConflictError('This document is already in the bin.'))
    await expect(moveNormToOfficeShelf(MANAGER, 'project-1', { documentId: 'doc-1' }, REQUEST)).rejects.toBeInstanceOf(ConflictError)
    expect(removeBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition-new', REQUEST)
    expect(insertReference).not.toHaveBeenCalled()
  })

  it('confirms the entry with the values the person confirmed when asked to', async () => {
    vi.mocked(confirmBaseKnowledge).mockResolvedValue(entry({ status: 'confirmed' }))
    const values = { designation: 'ÖNORM B 1600:2023', editionLabel: '2023-02-01' }
    await moveNormToOfficeShelf(MANAGER, 'project-1', { documentId: 'doc-1', values, confirm: true }, REQUEST)
    expect(uploadBaseKnowledge).toHaveBeenCalledWith(MANAGER, expect.any(File), REQUEST, values)
    expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition-new', values)
  })

  it('answers one placement per norm, a refused one not stopping the next', async () => {
    vi.mocked(getAccessibleDocument)
      .mockRejectedValueOnce(new ApiError(404, 'NOT_FOUND', 'Document not found'))
      .mockResolvedValueOnce(projectDocument({ id: 'doc-2' }))
    const placements = await moveNormsToOfficeShelf(MANAGER, 'project-1', [{ documentId: 'doc-1' }, { documentId: 'doc-2' }], REQUEST)
    expect(placements.map((placement) => placement.outcome)).toEqual(['refused', 'moved'])
  })

  it('applies an accepted suggestion as the person who accepts it', async () => {
    const results = await applyOfficeShelfNorm(
      { documents: [{ id: 'doc-1', name: 'OENORM_B_1600_2023-02-01.pdf', designation: 'ÖNORM B 1600:2023' }] },
      { session: MANAGER, projectId: 'project-1', request: REQUEST }
    )
    expect(getAccessibleDocument).toHaveBeenCalledWith(MANAGER, 'doc-1', 'write')
    expect(results).toEqual([{ label: 'ÖNORM B 1600:2023', ok: true, itemId: 'office-doc-1' }])
    expect(confirmBaseKnowledge).not.toHaveBeenCalled()
  })

  it('files an accepted suggestion confirmed, with the values the person who accepts it confirmed', async () => {
    vi.mocked(confirmBaseKnowledge).mockResolvedValue(entry({ status: 'confirmed' }))
    const values = { kind: 'technical_standard' as const, designation: 'ÖNORM B 1600:2023', editionLabel: '2023-02-01' }
    const results = await applyOfficeShelfNorm(
      { documents: [{ id: 'doc-1', name: 'OENORM_B_1600_2023-02-01.pdf', designation: 'ÖNORM B 1600' }] },
      { session: MANAGER, projectId: 'project-1', request: REQUEST, norms: [{ documentId: 'doc-1', values }] }
    )
    expect(uploadBaseKnowledge).toHaveBeenCalledWith(MANAGER, expect.any(File), REQUEST, values)
    expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition-new', values)
    expect(results).toEqual([{ label: 'ÖNORM B 1600', ok: true, itemId: 'office-doc-1' }])
  })

  it('says so when the accepted copy could not be confirmed', async () => {
    vi.mocked(confirmBaseKnowledge).mockRejectedValue(new ConflictError('Already confirmed elsewhere.'))
    const values = { kind: 'technical_standard' as const, designation: 'ÖNORM B 1600:2023', editionLabel: '2023-02-01' }
    const results = await applyOfficeShelfNorm(
      { documents: [{ id: 'doc-1', name: 'OENORM_B_1600_2023-02-01.pdf', designation: 'ÖNORM B 1600' }] },
      { session: MANAGER, projectId: 'project-1', request: REQUEST, norms: [{ documentId: 'doc-1', values }] }
    )
    expect(results).toEqual([{ label: 'ÖNORM B 1600', ok: true, itemId: 'office-doc-1', reason: 'Already confirmed elsewhere.' }])
  })
})
