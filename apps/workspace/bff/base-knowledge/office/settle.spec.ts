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
}))

import { ForbiddenError, NotFoundError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import type { BaseKnowledgeEntry } from '../wire'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import { moveEntry, removeEntry } from './bulk'
import { confirmBaseKnowledge, dropBaseKnowledgeRecords, storedEntryOf } from './service'
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
  ['edition_dup', stored('dup', { workId: 'work_b1600' }, { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' })],
  ['edition_noed', stored('noed', {}, { editionLabel: 'unbekannt', issuedOn: null })],
  ['edition_plan', stored('plan')],
  ['edition_b1600', HELD],
])

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(readOfficeEntries).mockResolvedValue([HELD, ...PROPOSALS.values()])
  vi.mocked(storedEntryOf).mockImplementation(async (_session, entryId) => {
    const found = PROPOSALS.get(entryId)
    if (!found) throw new NotFoundError('No base-knowledge entry with this id; list the entries first.')
    return { stored: found, entry: {} as BaseKnowledgeEntry }
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
    expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition_norm', {
      editionLabel: '2020-03-15',
      issuedOn: '2020-03-15',
      kind: 'guideline',
      designation: 'ÖNORM B 8110-3',
    })
    expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition_new', { editionLabel: '2023-02-01', issuedOn: '2023-02-01' })
    expect(confirmBaseKnowledge).toHaveBeenCalledTimes(2)
    expect(vi.mocked(moveEntry).mock.calls.map(([, entryId, folderId]) => [entryId, folderId])).toEqual([
      ['edition_norm', 'topic-waerme'],
      ['edition_new', 'topic-barrierefrei'],
    ])
    expect(removeEntry).toHaveBeenCalledWith(MANAGER, 'edition_dup', request)
    expect(dropBaseKnowledgeRecords).toHaveBeenCalledWith(MANAGER, PROPOSALS.get('edition_plan'))
    expect(dropBaseKnowledgeRecords).toHaveBeenCalledTimes(1)
  })

  it('files a row without a topic at the base-knowledge root, and keeps the read edition when none is sent', async () => {
    await settleProposals(MANAGER, { rows: [{ entryId: 'edition_norm' }] }, request)

    expect(confirmBaseKnowledge).toHaveBeenCalledWith(MANAGER, 'edition_norm', expect.objectContaining({ editionLabel: '2020-03-15' }))
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
