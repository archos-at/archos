import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../store/repository', () => ({ readOfficeEntries: vi.fn() }))
vi.mock('./bulk', () => ({ moveEntry: vi.fn(), removeEntry: vi.fn() }))
vi.mock('./folders', () => ({
  standardsRoot: vi.fn(async () => ({ id: 'folder-root' })),
  standardsFolderRows: vi.fn(async () => ({
    root: { id: 'folder-root' },
    folders: [{ id: 'topic-barrierefrei' }, { id: 'topic-waerme' }],
  })),
}))
vi.mock('./service', () => ({
  storedEntryOf: vi.fn(),
  confirmBaseKnowledge: vi.fn(),
  dropBaseKnowledgeRecords: vi.fn(),
  getBaseKnowledgeEntry: vi.fn(async () => ({ folderId: 'topic-barrierefrei' })),
  reviseProposal: vi.fn(),
}))
vi.mock('./folder-norms-repository', () => ({ keepAsOrdinaryFiles: vi.fn() }))
vi.mock('@/lib/documents/move-to-folder', () => ({ moveDocumentToFolder: vi.fn(async () => ({ ok: true })) }))
vi.mock('@/lib/office-shelf/folder-service', () => ({
  listOfficeShelfFolders: vi.fn(async () => [
    { id: 'folder-root', path: 'Grundlagen des Büros' },
    { id: 'topic-barrierefrei', path: 'Grundlagen des Büros/Barrierefreiheit' },
    { id: 'folder-plans', path: 'Pläne' },
  ]),
}))

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import type { BaseKnowledgeEntry } from '../wire'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import { moveEntry, removeEntry } from './bulk'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { keepAsOrdinaryFiles } from './folder-norms-repository'
import { confirmBaseKnowledge, dropBaseKnowledgeRecords, reviseProposal, storedEntryOf } from './service'
import { settleProposals } from './settle'

const MANAGER: AuthorizedSession = {
  userId: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'member',
  permissions: [ORG_PERMISSIONS.officeShelfManage],
  featureFlags: [],
}

const request = new Request('http://localhost/api/base-knowledge/settle', { method: 'POST' })

function stored(documentId: string, overrides: Partial<StoredEntry> = {}, values: Partial<StoredEntry['values']> = {}): StoredEntry {
  return {
    workId: `work_${documentId}`,
    workStandsAlone: false,
    editionId: `edition_${documentId}`,
    copyId: `manifestation_${documentId}`,
    documentId,
    confirmed: false,
    provenance: { proposedBy: 'reading' },
    terms: {},
    lastCheck: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
    values: {
      kind: 'technical_standard',
      title: 'Wärmeschutz im Hochbau',
      designation: 'ÖNORM B 8110-3',
      editionLabel: '2020-03-15',
      issuedOn: '2020-03-15',
      inForceFrom: null,
      inForceTo: null,
      territoryIds: [],
      issuer: 'Austrian Standards',
      addressees: [],
      licenceClass: 'public_open',
      ...values,
    },
  }
}

const HELD = stored('b1600', { confirmed: true, workId: 'work_b1600' }, { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' })
const PROPOSALS = new Map<string, StoredEntry>([
  ['edition_norm', stored('norm')],
  ['edition_new', stored('new', { workId: 'work_b1600' }, { designation: 'ÖNORM B 1600', editionLabel: '2023-02-01', issuedOn: '2023-02-01' })],
  ['edition_dup', stored('dup', { workId: 'work_b1600', provenance: { proposedBy: 'reading', filedFrom: { folderId: null, upload: true } } }, { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' })],
  ['edition_dupfolder', stored('dupfolder', { workId: 'work_b1600', provenance: { proposedBy: 'reading', filedFrom: { folderId: 'folder-plans' } } }, { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' })],
  ['edition_noed', stored('noed', {}, { editionLabel: 'unbekannt', issuedOn: null })],
  ['edition_plan', stored('plan', { provenance: { proposedBy: 'reading', filedFrom: { folderId: 'folder-plans' } } })],
  ['edition_gonefolder', stored('gonefolder', { provenance: { proposedBy: 'reading', filedFrom: { folderId: 'folder-deleted' } } })],
  ['edition_topfolder', stored('topfolder', { provenance: { proposedBy: 'reading', filedFrom: { folderId: null } } })],
  ['edition_b1600', HELD],
  ['edition_newnoed', stored('newnoed', { workId: 'work_b1600' }, { designation: 'ÖNORM B 1600', editionLabel: 'unbekannt', issuedOn: null })],
])
const FOLDER_OF = new Map<string, string | null>([
  ['edition_noed', null],
  ['edition_plan', 'folder-root'],
  ['edition_gonefolder', 'topic-barrierefrei'],
  ['edition_topfolder', 'folder-root'],
  ['edition_dupfolder', 'folder-root'],
])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readOfficeEntries).mockResolvedValue([HELD, ...PROPOSALS.values()])
  vi.mocked(storedEntryOf).mockImplementation(async (_session, entryId) => {
    const found = PROPOSALS.get(entryId)
    if (!found) throw new NotFoundError('No base-knowledge entry with this id; list the entries first.')
    return { stored: found, entry: { folderId: FOLDER_OF.get(entryId) ?? null } as BaseKnowledgeEntry }
  })
})

describe('settling the norm dialog', () => {
  it('needs the right to manage the office shelf', async () => {
    await expect(settleProposals({ ...MANAGER, permissions: [] }, { rows: [{ entryId: 'edition_norm' }] }, request)).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('confirms each row by its kind and settles every other row by its own rule', async () => {
    const { results } = await settleProposals(
      MANAGER,
      {
        rows: [
          { entryId: 'edition_norm', kind: 'guideline', designation: 'ÖNORM B 8110-3', editionLabel: '2020-03-15', topicId: 'topic-waerme' },
          { entryId: 'edition_new', editionLabel: '2023-02-01', topicId: 'topic-waerme' },
          { entryId: 'edition_dup', editionLabel: '2017-04-01' },
          { entryId: 'edition_noed', editionLabel: '' },
          { entryId: 'edition_plan', notNorm: true },
          { entryId: 'edition_gone' },
        ],
      },
      request,
    )

    expect(results.map(({ entryId, outcome }) => [entryId, outcome])).toEqual([
      ['edition_norm', 'confirmed'],
      ['edition_new', 'edition_added'],
      ['edition_dup', 'duplicate_removed'],
      ['edition_noed', 'edition_missing'],
      ['edition_plan', 'not_norm'],
      ['edition_gone', 'failed'],
    ])
    expect(confirmBaseKnowledge).toHaveBeenCalledWith(
      MANAGER,
      'edition_norm',
      { editionLabel: '2020-03-15', issuedOn: '2020-03-15', kind: 'guideline', designation: 'ÖNORM B 8110-3' },
      { licenceStep: false },
    )
    expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition_new', { editionLabel: '2023-02-01', issuedOn: '2023-02-01' }, { licenceStep: false })
    expect(confirmBaseKnowledge).toHaveBeenCalledTimes(2)
    expect(vi.mocked(moveEntry).mock.calls.map(([, entryId, folderId]) => [entryId, folderId])).toEqual([
      ['edition_norm', 'topic-waerme'],
      ['edition_new', 'topic-barrierefrei'],
    ])
    expect(removeEntry).toHaveBeenCalledWith(MANAGER, 'edition_dup', request)
    expect(dropBaseKnowledgeRecords).toHaveBeenCalledWith(MANAGER, PROPOSALS.get('edition_plan'))
  })

  it('never deletes a duplicate that came out of an Ordner folder: it goes back there as an ordinary file and is remembered', async () => {
    const { results } = await settleProposals(MANAGER, { rows: [{ entryId: 'edition_dupfolder', editionLabel: '2017-04-01 ' }] }, request)

    expect(results[0].outcome).toBe('duplicate_returned')
    expect(removeEntry).not.toHaveBeenCalled()
    expect(confirmBaseKnowledge).not.toHaveBeenCalled()
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: 'dupfolder', folderId: 'folder-plans' }, MANAGER)
    expect(dropBaseKnowledgeRecords).toHaveBeenCalledWith(MANAGER, PROPOSALS.get('edition_dupfolder'))
    expect(keepAsOrdinaryFiles).toHaveBeenCalledWith('org-1', ['dupfolder'], 'user-1')
  })

  it('drops a plain file’s records where it lies when it lies outside the norms, and remembers it as an ordinary file', async () => {
    const { results } = await settleProposals(MANAGER, { rows: [{ entryId: 'edition_noed', notNorm: true }] }, request)

    expect(results[0].outcome).toBe('not_norm')
    expect(dropBaseKnowledgeRecords).toHaveBeenCalledWith(MANAGER, PROPOSALS.get('edition_noed'))
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
    expect(keepAsOrdinaryFiles).toHaveBeenCalledWith('org-1', ['noed'], 'user-1')
  })

  it('remembers “Keine Norm”, so neither the folder scan nor an upload offers the file again', async () => {
    await settleProposals(MANAGER, { rows: [{ entryId: 'edition_plan', notNorm: true }] }, request)

    expect(keepAsOrdinaryFiles).toHaveBeenCalledWith('org-1', ['plan'], 'user-1')
  })

  it('takes “Keine Norm” back to the Ordner folder the file came from, or to the top level when that folder is gone', async () => {
    await settleProposals(
      MANAGER,
      {
        rows: [
          { entryId: 'edition_plan', notNorm: true },
          { entryId: 'edition_gonefolder', notNorm: true },
          { entryId: 'edition_topfolder', notNorm: true },
        ],
      },
      request,
    )

    expect(vi.mocked(moveDocumentToFolder).mock.calls.map(([input]) => input)).toEqual([
      { documentId: 'plan', folderId: 'folder-plans' },
      { documentId: 'gonefolder', folderId: null },
      { documentId: 'topfolder', folderId: null },
    ])
    expect(vi.mocked(moveDocumentToFolder).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(dropBaseKnowledgeRecords).mock.invocationCallOrder[0])
  })

  it('keeps the edits of a row without an edition on its proposal, so the dialog opens again with them', async () => {
    const { results } = await settleProposals(
      MANAGER,
      { rows: [{ entryId: 'edition_noed', kind: 'guideline', designation: 'ÖNORM B 8110-5', editionLabel: '', topicId: 'topic-waerme' }] },
      request,
    )

    expect(results[0].outcome).toBe('edition_missing')
    expect(reviseProposal).toHaveBeenCalledWith(MANAGER, 'edition_noed', {
      kind: 'guideline',
      designation: 'ÖNORM B 8110-5',
      editionLabel: 'unbekannt',
      issuedOn: null,
    })
    expect(moveEntry).toHaveBeenCalledWith(MANAGER, 'edition_noed', 'topic-waerme')
    expect(confirmBaseKnowledge).not.toHaveBeenCalled()
  })

  it('takes a row without an edition and without a topic out of the Ordner, to wait at the standards root', async () => {
    await settleProposals(MANAGER, { rows: [{ entryId: 'edition_noed', kind: 'guideline', topicId: null }] }, request)

    expect(reviseProposal).toHaveBeenCalledWith(MANAGER, 'edition_noed', { kind: 'guideline', designation: undefined })
    expect(moveEntry).toHaveBeenCalledWith(MANAGER, 'edition_noed', 'folder-root')
  })

  it('leaves a row without an edition and without a topic where it lies when it already waits at the standards root', async () => {
    await settleProposals(MANAGER, { rows: [{ entryId: 'edition_plan', kind: 'guideline', editionLabel: '', topicId: null }] }, request)

    expect(moveEntry).not.toHaveBeenCalled()
  })

  it('keeps a new edition without an edition label in its work: no kind, designation or topic of its own', async () => {
    await settleProposals(MANAGER, { rows: [{ entryId: 'edition_newnoed', kind: 'guideline', designation: 'X', topicId: 'topic-waerme' }] }, request)

    expect(reviseProposal).toHaveBeenCalledWith(MANAGER, 'edition_newnoed', {})
    expect(moveEntry).not.toHaveBeenCalled()
  })

  it('records a new edition of a licensed work without asking for the licence statement while the step is off', async () => {
    PROPOSALS.set('edition_licensed', stored('licensed', { workId: 'work_b1600' }, { designation: 'ÖNORM B 1600', editionLabel: '2023-02-01', licenceClass: 'licensed' }))
    try {
      const { results } = await settleProposals(MANAGER, { rows: [{ entryId: 'edition_licensed', editionLabel: '2023-02-01' }] }, request)

      expect(results[0]).toEqual({ entryId: 'edition_licensed', outcome: 'edition_added', error: null })
      expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition_licensed', expect.anything(), { licenceStep: false })
    } finally {
      PROPOSALS.delete('edition_licensed')
    }
  })

  it('files a row without a topic at the base-knowledge root, and keeps the read edition when none is sent', async () => {
    await settleProposals(MANAGER, { rows: [{ entryId: 'edition_norm' }] }, request)

    expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition_norm', expect.objectContaining({ editionLabel: '2020-03-15' }), { licenceStep: false })
    expect(moveEntry).toHaveBeenCalledWith(MANAGER, 'edition_norm', 'folder-root')
  })

  it('refuses a topic outside the base knowledge and a confirmed entry turned into a plain file', async () => {
    const { results } = await settleProposals(
      MANAGER,
      { rows: [{ entryId: 'edition_norm', topicId: '00000000-0000-4000-8000-000000000000' }, { entryId: 'edition_b1600', notNorm: true }] },
      request,
    )

    expect(results.map((result) => result.outcome)).toEqual(['failed', 'failed'])
    expect(confirmBaseKnowledge).not.toHaveBeenCalled()
    expect(dropBaseKnowledgeRecords).not.toHaveBeenCalled()
  })
})
