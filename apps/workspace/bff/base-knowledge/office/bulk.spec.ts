/**
 * One change to many entries (`bulk.ts`) and a newer edition (`new-edition.ts`)
 * over the mocked single-entry service: each entry runs on its own, a refusal
 * names the entry and the rest still run, a move lands only in a base-knowledge
 * folder, and a newer edition joins the earlier one's work and keeps it, with a check that says so.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./service', () => ({
  getBaseKnowledgeEntry: vi.fn(),
  recordBaseKnowledgeCheck: vi.fn(),
  removeBaseKnowledge: vi.fn(),
  uploadBaseKnowledge: vi.fn(async () => ({ id: 'work_new' })),
  storedEntryOf: vi.fn(),
}))
vi.mock('./folders', () => ({ isStandardsFolder: vi.fn(async (_s: unknown, id: string) => id === 'folder-brandschutz') }))
vi.mock('@/lib/documents/move-to-folder', () => ({ moveDocumentToFolder: vi.fn(async () => ({ ok: true })) }))

import { ConflictError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import type { BaseKnowledgeEntry } from '../wire'
import { bulkBaseKnowledge } from './bulk'
import { addBaseKnowledgeEdition } from './new-edition'
import { getBaseKnowledgeEntry, recordBaseKnowledgeCheck, removeBaseKnowledge, storedEntryOf, uploadBaseKnowledge } from './service'

const MANAGER = {
  userId: 'user-1',
  organizationId: 'org-1',
  permissions: [ORG_PERMISSIONS.officeShelfManage],
  featureFlags: [],
} as unknown as AuthorizedSession
const request = new Request('http://localhost/api/base-knowledge/bulk')

const REMOVED: Awaited<ReturnType<typeof removeBaseKnowledge>> = {
  removed: true,
  stores: { database: 'removed', search: 'removed', objects: 'removed', records: 'removed', caches: 'removed' },
}

const ENTRY = {
  id: 'work_1',
  documentId: 'doc-1',
  folderId: 'folder-brandschutz',
  status: 'confirmed',
  values: {
    kind: 'technical_standard',
    title: 'Barrierefreies Bauen',
    designation: 'ÖNORM B 1600:2017',
    editionLabel: '2017-04-01',
    issuedOn: null,
    territoryIds: [],
    issuer: 'Austrian Standards',
    addressees: [],
    licenceClass: 'licensed',
  },
} as unknown as BaseKnowledgeEntry

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getBaseKnowledgeEntry).mockResolvedValue({ ...ENTRY, folderId: null })
})

describe('bulk', () => {
  it('is a shelf manager’s', async () => {
    const member = { ...MANAGER, permissions: [] } as AuthorizedSession
    await expect(bulkBaseKnowledge(member, { entryIds: ['work_1'], action: { type: 'remove' } }, request)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('runs each entry and names the one refused', async () => {
    vi.mocked(recordBaseKnowledgeCheck).mockResolvedValueOnce(ENTRY).mockRejectedValueOnce(new ConflictError('Confirm the entry before recording a check.'))
    const { results } = await bulkBaseKnowledge(MANAGER, { entryIds: ['work_1', 'work_2', 'work_1'], action: { type: 'check', result: 'current' } }, request)
    expect(results).toEqual([
      { entryId: 'work_1', ok: true, error: null },
      { entryId: 'work_2', ok: false, error: 'Confirm the entry before recording a check.' },
    ])
  })

  it('moves only into a base-knowledge folder', async () => {
    const outside = bulkBaseKnowledge(MANAGER, { entryIds: ['work_1'], action: { type: 'move', folderId: '00000000-0000-4000-8000-000000000001' } }, request)
    await expect(outside).rejects.toBeInstanceOf(UnprocessableError)
    await bulkBaseKnowledge(MANAGER, { entryIds: ['work_1'], action: { type: 'move', folderId: 'folder-brandschutz' } }, request)
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: 'doc-1', folderId: 'folder-brandschutz' }, MANAGER)
  })

  it('removes through the single-entry removal', async () => {
    vi.mocked(removeBaseKnowledge).mockResolvedValue(REMOVED)
    const answer = await bulkBaseKnowledge(MANAGER, { entryIds: ['work_1'], action: { type: 'remove' } }, request)
    expect(removeBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'work_1', request)
    expect(answer.results).toEqual([{ entryId: 'work_1', ok: true, error: null }])
  })

  it('reports a removal some store could not finish as failed, naming the store', async () => {
    vi.mocked(removeBaseKnowledge).mockResolvedValue({ removed: false, stores: { ...REMOVED.stores, objects: 'partial' } })
    const answer = await bulkBaseKnowledge(MANAGER, { entryIds: ['work_1'], action: { type: 'remove' } }, request)
    expect(answer.results[0]).toMatchObject({ entryId: 'work_1', ok: false })
    expect(answer.results[0].error).toContain('objects')
  })
})

describe('a newer edition', () => {
  it('is kept when the check on the earlier edition does not land', async () => {
    vi.mocked(storedEntryOf).mockResolvedValue({ stored: {}, entry: ENTRY } as unknown as Awaited<ReturnType<typeof storedEntryOf>>)
    vi.mocked(uploadBaseKnowledge).mockResolvedValue(ENTRY)
    vi.mocked(recordBaseKnowledgeCheck).mockRejectedValueOnce(new Error('database gone'))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(addBaseKnowledgeEdition(MANAGER, 'work_1', new File(['%PDF'], 'n.pdf'), request)).resolves.toBe(ENTRY)
  })

  it('joins the earlier entry’s work in its folder, and the earlier one stays with a check that found it', async () => {
    const stored = { workId: 'work_1', editionId: 'work_1' }
    vi.mocked(storedEntryOf).mockResolvedValue({ stored, entry: ENTRY } as unknown as Awaited<ReturnType<typeof storedEntryOf>>)
    const file = new File(['%PDF'], 'ÖNORM B 1600_2023.pdf')
    await addBaseKnowledgeEdition(MANAGER, 'work_1', file, request)
    expect(uploadBaseKnowledge).toHaveBeenCalledWith(MANAGER, file, request, { folderId: 'folder-brandschutz', editionOf: stored })
    expect(recordBaseKnowledgeCheck).toHaveBeenCalledWith(MANAGER, 'work_1', { result: 'newer_known', note: 'ÖNORM B 1600_2023.pdf' })
    expect(removeBaseKnowledge).not.toHaveBeenCalled()
  })
})
