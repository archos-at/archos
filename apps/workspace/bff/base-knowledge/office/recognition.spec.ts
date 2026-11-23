import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../store/repository', () => ({ readOfficeEntries: vi.fn() }))
vi.mock('./repository', () => ({ visibleOfficeDocuments: vi.fn() }))
vi.mock('./norm-intake', () => ({ takeAsNorm: vi.fn() }))
vi.mock('./folder-norms-repository', () => ({ keptAsOrdinaryFiles: vi.fn(async () => new Set()) }))
vi.mock('./folders', () => ({
  standardsRoot: vi.fn(async () => ({ id: 'folder-root' })),
  standardsFolderRows: vi.fn(async () => ({
    root: { id: 'folder-root', parentId: null, name: 'Grundlagen des Büros', path: 'Grundlagen des Büros' },
    folders: [
      { id: 'topic-barrierefrei', parentId: 'folder-root', name: 'Barrierefreiheit', path: 'Grundlagen des Büros/Barrierefreiheit' },
      { id: 'topic-weisungen', parentId: 'folder-root', name: 'Weisungen', path: 'Grundlagen des Büros/Weisungen' },
    ],
  })),
  listBaseKnowledgeFolders: vi.fn(async () => ({ rootId: 'folder-root', folders: [], nextCursor: null })),
}))
vi.mock('@/lib/office-shelf/folder-service', () => ({
  listOfficeShelfFolders: vi.fn(async () => [{ id: 'folder-plans', parentId: null, name: 'Pläne', path: 'Pläne' }]),
}))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'member', userId: 'user-1' })) }))

import { ForbiddenError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import { visibleOfficeDocuments, type EntryDocument } from './repository'
import { keptAsOrdinaryFiles } from './folder-norms-repository'
import { takeAsNorm } from './norm-intake'
import { proposeTopic, recognizeUploads } from './recognition'

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

const doc = (id: string, fileName: string, folderId: string | null = null): EntryDocument => ({
  id,
  fileName,
  collectionName: 'archiv_org-1',
  storedName: fileName,
  folderId,
})

function stored(overrides: Partial<StoredEntry> & { documentId: string }, values: Partial<StoredEntry['values']> = {}): StoredEntry {
  return {
    workId: `work_${overrides.documentId}`,
    workStandsAlone: false,
    editionId: `edition_${overrides.documentId}`,
    copyId: `manifestation_${overrides.documentId}`,
    confirmed: false,
    provenance: { proposedBy: 'reading' },
    terms: {},
    lastCheck: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    ...overrides,
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation: 'ÖNORM B 1600',
      editionLabel: '2017-04-01',
      issuedOn: '2017-04-01',
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

const B1600 = stored({ documentId: 'doc-b1600', confirmed: true })
const SHELF = new Map([
  ['doc-b1600', doc('doc-b1600', 'ÖNORM B 1600.pdf', 'topic-barrierefrei')],
  ['doc-norm', doc('doc-norm', 'OENORM_B_8110-3_2020-03-15_de.pdf')],
  ['doc-plan', doc('doc-plan', 'Haus_A_2024_Einreichung.pdf', 'folder-plans')],
  ['doc-oib', doc('doc-oib', 'OIB-RL 4 2023.pdf')],
  ['doc-edition', doc('doc-edition', 'OENORM_B_1600_2023-02-01_de.pdf')],
  ['doc-same', doc('doc-same', 'ÖNORM B 1600 2017-04-01 Kopie.pdf')],
])

function shelf(...ids: string[]) {
  vi.mocked(visibleOfficeDocuments).mockImplementation(async (_org, wanted) => {
    const visible = new Set(ids)
    return new Map([...SHELF].filter(([id]) => visible.has(id) && wanted.includes(id)))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  shelf(...SHELF.keys())
})

describe('recognising an upload', () => {
  it('needs the right to manage the office shelf', async () => {
    await expect(recognizeUploads({ ...MANAGER, permissions: [] }, { documentIds: ['doc-norm'] })).rejects.toBeInstanceOf(ForbiddenError)
    expect(takeAsNorm).not.toHaveBeenCalled()
  })

  it('takes a norm out of the Ordner, and leaves other files where they landed', async () => {
    vi.mocked(readOfficeEntries)
      .mockResolvedValueOnce([B1600])
      .mockResolvedValueOnce([B1600, stored({ documentId: 'doc-norm' }, { designation: 'ÖNORM B 8110-3', editionLabel: '2020-03-15' })])

    const answer = await recognizeUploads(MANAGER, { documentIds: ['doc-norm', 'doc-plan', 'doc-oib'] })

    expect(takeAsNorm).toHaveBeenCalledTimes(1)
    expect(takeAsNorm).toHaveBeenCalledWith(
      MANAGER,
      { documentId: 'doc-norm', fileName: 'OENORM_B_8110-3_2020-03-15_de.pdf', folderId: null, designation: 'ÖNORM B 8110-3' },
      { rootId: 'folder-root', entries: [B1600], standards: new Set(['folder-root', 'topic-barrierefrei', 'topic-weisungen']) },
    )
    expect(answer.proposals).toEqual([
      expect.objectContaining({ documentId: 'doc-norm', designation: 'ÖNORM B 8110-3', editionLabel: '2020-03-15', editionOf: null, duplicate: false }),
    ])
    expect(answer.plain).toEqual([
      { documentId: 'doc-plan', fileName: 'Haus_A_2024_Einreichung.pdf', folderId: 'folder-plans', folderPath: 'Pläne', platformHeld: false },
      { documentId: 'doc-oib', fileName: 'OIB-RL 4 2023.pdf', folderId: null, folderPath: null, platformHeld: true },
    ])
  })

  it('records a matching designation as a new edition of the confirmed work, in that work’s topic', async () => {
    const edition = stored({ documentId: 'doc-edition', workId: B1600.workId, workStandsAlone: true }, { editionLabel: '2023-02-01' })
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([B1600]).mockResolvedValueOnce([B1600, edition])

    const answer = await recognizeUploads(MANAGER, { documentIds: ['doc-edition'] })

    expect(vi.mocked(takeAsNorm).mock.calls[0][2].entries).toEqual([B1600])
    expect(answer.proposals).toEqual([
      expect.objectContaining({
        documentId: 'doc-edition',
        editionOf: { entryId: B1600.editionId, designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' },
        duplicate: false,
        topicId: 'topic-barrierefrei',
      }),
    ])
  })

  it('names where the cover page disagreed with the file name, and nothing for a proposal read from its name', async () => {
    const overrode = [{ field: 'editionLabel' as const, fileName: '2017-04-01' }]
    const covered = stored(
      { documentId: 'doc-edition', provenance: { proposedBy: 'reading', cover: { read: { designation: 'cover', editionLabel: 'cover', title: 'cover' }, overrode, replaces: [] } } },
      { editionLabel: '2023-02-01' },
    )
    const named = stored({ documentId: 'doc-norm' }, { designation: 'ÖNORM B 8110-3', editionLabel: '2020-03-15' })
    vi.mocked(readOfficeEntries).mockResolvedValue([covered, named])

    const answer = await recognizeUploads(MANAGER, { documentIds: ['doc-edition', 'doc-norm'] })

    expect(answer.proposals.map((proposal) => proposal.coverOverrode)).toEqual([overrode, []])
  })

  it('flags an edition the office already holds as a duplicate', async () => {
    const same = stored({ documentId: 'doc-same', workId: B1600.workId }, { editionLabel: '2017-04-01' })
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([B1600]).mockResolvedValueOnce([B1600, same])

    const answer = await recognizeUploads(MANAGER, { documentIds: ['doc-same'] })

    expect(answer.proposals).toEqual([expect.objectContaining({ documentId: 'doc-same', duplicate: true })])
  })

  it('answers a document already proposed again without recording it twice', async () => {
    const proposed = stored({ documentId: 'doc-norm' }, { designation: 'ÖNORM B 8110-3', editionLabel: 'unbekannt' })
    vi.mocked(readOfficeEntries).mockResolvedValue([B1600, proposed])

    const answer = await recognizeUploads(MANAGER, { documentIds: ['doc-norm', 'doc-norm'] })

    expect(takeAsNorm).not.toHaveBeenCalled()
    expect(answer.proposals).toEqual([expect.objectContaining({ documentId: 'doc-norm', editionLabel: null })])
  })

  it('proposes an ordinary file when asked to keep it as a norm', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([]).mockResolvedValueOnce([stored({ documentId: 'doc-plan' })])

    const answer = await recognizeUploads(MANAGER, { documentIds: ['doc-plan'], asNorm: true })

    expect(vi.mocked(takeAsNorm).mock.calls[0][1]).toEqual({
      documentId: 'doc-plan',
      fileName: 'Haus_A_2024_Einreichung.pdf',
      folderId: 'folder-plans',
      designation: null,
    })
    expect(keptAsOrdinaryFiles).not.toHaveBeenCalled()
    expect(answer.plain).toEqual([])
    expect(answer.proposals.map((proposal) => proposal.documentId)).toEqual(['doc-plan'])
  })

  it('leaves a file somebody kept as an ordinary file alone, though its name reads as a norm', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([])
    vi.mocked(keptAsOrdinaryFiles).mockResolvedValueOnce(new Set(['doc-norm']))

    const answer = await recognizeUploads(MANAGER, { documentIds: ['doc-norm'] })

    expect(takeAsNorm).not.toHaveBeenCalled()
    expect(answer.plain).toEqual([expect.objectContaining({ documentId: 'doc-norm', platformHeld: false })])
  })
})

describe('proposing a topic', () => {
  it('takes the topic most confirmed entries of the same kind lie in', () => {
    const directive = (id: string, folder: string) => [stored({ documentId: id, confirmed: true }, { kind: 'authority_directive' }), folder] as const
    const rows = [directive('a', 'topic-weisungen'), directive('b', 'topic-weisungen'), directive('c', 'topic-barrierefrei')]
    const entries = [...rows.map(([entry]) => entry), stored({ documentId: 'd', confirmed: true }), stored({ documentId: 'e' }, { kind: 'authority_directive' })]
    const folders = new Map<string, string | null>([...rows.map(([entry, folder]) => [entry.documentId, folder] as const), ['d', 'topic-barrierefrei'], ['e', 'topic-barrierefrei']])
    const topics = new Set(['topic-weisungen', 'topic-barrierefrei'])

    expect(proposeTopic('authority_directive', entries, folders, topics)).toBe('topic-weisungen')
    expect(proposeTopic('commentary', entries, folders, topics)).toBeNull()
  })
})
