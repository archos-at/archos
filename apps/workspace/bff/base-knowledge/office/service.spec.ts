/**
 * The office's base-knowledge service (ADR-0158) over mocked repositories: who
 * may do what, that a proposal merges the reading with what a caller read, that
 * a licensed copy needs the attestation, that confirming checks it, that removal
 * runs the office shelf's own delete, and that the flag gates the turn.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('../store/repository', () => ({
  documentHasEntry: vi.fn(async () => false),
  insertCopyCheck: vi.fn(),
  insertProposedEntry: vi.fn(async () => ({ workId: 'work_1', editionId: 'edition_1', copyId: 'manifestation_1' })),
  readOfficeEntries: vi.fn(async () => []),
  writeConfirmedValues: vi.fn(),
}))
vi.mock('./repository', () => ({
  readDocumentReading: vi.fn(),
  visibleOfficeDocuments: vi.fn(),
}))
vi.mock('./mark', () => ({ markCopyPoints: vi.fn(async () => true) }))
vi.mock('./text-effects', () => ({ withholdText: vi.fn(async () => true), releaseText: vi.fn() }))
vi.mock('@/lib/office-shelf/service', () => ({ deleteOfficeShelfDocument: vi.fn() }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'member', userId: 'user-1' })) }))
vi.mock('@/lib/workos/feature-flags', () => ({ isOrgFeatureEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/projects/repository', () => ({ findProjectProfileInOrg: vi.fn(async () => null) }))
vi.mock('@/lib/authz/feature-flags', async (original) => ({
  ...(await original<typeof import('@/lib/authz/feature-flags')>()),
  isFeatureEnabled: vi.fn((session: { featureFlags: string[] | null }, flag: string) => session.featureFlags?.includes(flag) ?? false),
}))

import { ConflictError, ForbiddenError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { deleteOfficeShelfDocument } from '@/lib/office-shelf/service'
import { findProjectProfileInOrg } from '@/lib/projects/repository'
import { isOrgFeatureEnabled } from '@/lib/workos/feature-flags'
import {
  documentHasEntry,
  insertProposedEntry,
  readOfficeEntries,
  writeConfirmedValues,
  type StoredEntry,
} from '../store/repository'
import { markCopyPoints } from './mark'
import { readDocumentReading, visibleOfficeDocuments } from './repository'
import { releaseText, withholdText } from './text-effects'
import {
  BaseKnowledgeDisabledError,
  baseKnowledgeForTurn,
  confirmBaseKnowledge,
  listBaseKnowledge,
  proposeBaseKnowledge,
  removeBaseKnowledge,
} from './service'

const MANAGER: AuthorizedSession = {
  userId: 'user-1',
  email: 'user@example.com',
  name: 'Test User',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'member',
  permissions: [ORG_PERMISSIONS.officeShelfManage],
  featureFlags: ['office-base-knowledge'],
}
const MEMBER: AuthorizedSession = { ...MANAGER, permissions: [] }
const FLAG_OFF: AuthorizedSession = { ...MANAGER, featureFlags: [] }

const DOCUMENT = { id: 'doc-1', fileName: 'ÖNORM B 1600.pdf', collectionName: 'archiv_org-1', storedName: 'ÖNORM B 1600.pdf' }

function stored(overrides: Partial<StoredEntry> = {}): StoredEntry {
  return {
    workId: 'work_1',
    editionId: 'edition_1',
    copyId: 'manifestation_1',
    documentId: 'doc-1',
    confirmed: false,
    provenance: { proposedBy: 'reading' },
    terms: {},
    lastCheck: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    values: {
      kind: 'technical_standard',
      title: 'Barrierefreies Bauen',
      designation: 'ÖNORM B 1600:2017',
      editionLabel: '2017-04-01',
      issuedOn: '2017-04-01',
      territoryIds: [],
      issuer: 'Austrian Standards',
      addressees: [],
      licenceClass: 'licensed',
    },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(visibleOfficeDocuments).mockResolvedValue(new Map([['doc-1', DOCUMENT]]))
  vi.mocked(readOfficeEntries).mockResolvedValue([stored()])
  vi.mocked(documentHasEntry).mockResolvedValue(false)
  vi.mocked(isOrgFeatureEnabled).mockResolvedValue(true)
})

describe('who may do what', () => {
  it('lists nothing and refuses every write while the flag is off', async () => {
    expect(await listBaseKnowledge(FLAG_OFF)).toEqual({ enabled: false, canManage: false, entries: [], nextCursor: null })
    await expect(proposeBaseKnowledge(FLAG_OFF, { documentId: 'doc-1' })).rejects.toBeInstanceOf(BaseKnowledgeDisabledError)
  })

  it('lets any member read and only a shelf manager write', async () => {
    const list = await listBaseKnowledge(MEMBER)
    expect(list.canManage).toBe(false)
    expect(list.entries.map((entry) => entry.id)).toEqual(['work_1'])
    await expect(confirmBaseKnowledge(MEMBER, 'work_1', {})).rejects.toBeInstanceOf(ForbiddenError)
  })

  it('leaves out an entry whose document the reader may not see', async () => {
    vi.mocked(visibleOfficeDocuments).mockResolvedValue(new Map())
    expect((await listBaseKnowledge(MANAGER)).entries).toEqual([])
  })
})

describe('proposing', () => {
  it('takes what the caller read over what the reading guessed, and says whose values they are', async () => {
    vi.mocked(readDocumentReading).mockResolvedValue({ fileName: 'scan.pdf', document: DOCUMENT })
    await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1', designation: 'ÖNORM B 1600:2017', editionLabel: '2017-04-01' }, 'agent')
    expect(insertProposedEntry).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ designation: 'ÖNORM B 1600:2017', editionLabel: '2017-04-01', title: 'scan' }),
      expect.objectContaining({ organizationId: 'org-1', provenance: { proposedBy: 'agent' } }),
    )
  })

  it('takes a licensed copy’s passages out of the index at once: metadata-only until the AI statement', async () => {
    vi.mocked(readDocumentReading).mockResolvedValue({ fileName: 'ÖNORM B 1600.pdf', document: DOCUMENT })
    await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1', licenceClass: 'licensed' })
    expect(withholdText).toHaveBeenCalledWith(MANAGER, 'doc-1')
  })

  it('leaves a public directive’s passages where they are', async () => {
    vi.mocked(readDocumentReading).mockResolvedValue({ fileName: 'MA37_Weisung.pdf', document: DOCUMENT })
    await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1' })
    expect(withholdText).not.toHaveBeenCalled()
  })

  it('refuses a second entry for one document', async () => {
    vi.mocked(readDocumentReading).mockResolvedValue({ fileName: 'scan.pdf', document: DOCUMENT })
    vi.mocked(documentHasEntry).mockResolvedValue(true)
    await expect(proposeBaseKnowledge(MANAGER, { documentId: 'doc-1' })).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('confirming', () => {
  it('needs the licence attestation for a licensed copy', async () => {
    await expect(confirmBaseKnowledge(MANAGER, 'work_1', {})).rejects.toBeInstanceOf(UnprocessableError)
    expect(writeConfirmedValues).not.toHaveBeenCalled()
  })

  it('moves the heads with the corrections, and counts as the first check', async () => {
    await confirmBaseKnowledge(MANAGER, 'work_1', { licenceAttested: true, editionLabel: '2017-05-01' })
    expect(writeConfirmedValues).toHaveBeenCalledWith(
      expect.objectContaining({ workId: 'work_1' }),
      expect.objectContaining({ editionLabel: '2017-05-01' }),
      expect.objectContaining({ firstCheck: true, provenance: { proposedBy: 'person' } }),
    )
  })

  it('keeps a licensed copy metadata-only when only office-wide use is stated', async () => {
    await confirmBaseKnowledge(MANAGER, 'work_1', { licenceAttested: true })
    expect(writeConfirmedValues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ terms: expect.objectContaining({ attestedBy: 'user-1' }) }),
    )
    expect(withholdText).toHaveBeenCalledWith(MANAGER, 'doc-1')
    expect(releaseText).not.toHaveBeenCalled()
  })

  it('reads the text again once the office states its licence covers AI processing, and says who and when', async () => {
    await confirmBaseKnowledge(MANAGER, 'work_1', { licenceAttested: true, aiProcessingAttested: true })
    expect(writeConfirmedValues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({
        terms: expect.objectContaining({ aiProcessingAttestedBy: 'user-1', aiProcessingAttestedAt: expect.any(String) }),
      }),
    )
    expect(releaseText).toHaveBeenCalledWith(MANAGER, 'doc-1')
    expect(withholdText).not.toHaveBeenCalled()
    expect(markCopyPoints).not.toHaveBeenCalled()
  })

  it('refuses to confirm twice', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([stored({ confirmed: true })])
    await expect(confirmBaseKnowledge(MANAGER, 'work_1', { licenceAttested: true })).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('removing', () => {
  it('runs the office shelf’s own delete, which takes the records with it', async () => {
    const request = new Request('http://localhost/api/base-knowledge/work_1', { method: 'DELETE' })
    await removeBaseKnowledge(MANAGER, 'work_1', request)
    expect(deleteOfficeShelfDocument).toHaveBeenCalledWith(MANAGER, 'doc-1', request)
  })
})

describe('the turn', () => {
  it('carries nothing while the organization does not have the flag', async () => {
    vi.mocked(isOrgFeatureEnabled).mockResolvedValue(false)
    expect(await baseKnowledgeForTurn('org-1', 'proj-1')).toBeNull()
    expect(readOfficeEntries).not.toHaveBeenCalled()
  })

  it('carries confirmed entries only, with the project’s territory for directives', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([
      stored({ confirmed: true }),
      stored({ workId: 'work_2', documentId: 'doc-1', confirmed: false }),
    ])
    vi.mocked(findProjectProfileInOrg).mockResolvedValue({
      profile: { facts: { federal_state: { value: 'vienna' } } },
    } as unknown as Awaited<ReturnType<typeof findProjectProfileInOrg>>)
    const block = await baseKnowledgeForTurn('org-1', 'proj-1')
    expect(block?.split('\n')).toHaveLength(2)
    expect(block).toContain('ÖNORM B 1600:2017')
  })
})
