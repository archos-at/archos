/**
 * The office's base-knowledge service (ADR-0163) over mocked repositories: who
 * may do what, that a proposal merges the reading with what a caller read, that
 * a licensed copy needs the attestation, that confirming checks it, that removal
 * runs the office shelf's own delete, and that the flag gates the turn.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/project-intake/setup-records', async () => ({
  // The records an operator publishes for Austria, as `readSetupRecords` hands them over (the database read is its own spec).
  readSetupRecords: async () => (await import('@/lib/project-intake/at-setup.fixtures')).AT_SETUP_RECORDS,
}))
vi.mock('../store/repository', () => ({
  documentHasEntry: vi.fn(async () => false),
  insertCopyCheck: vi.fn(),
  insertProposedEntry: vi.fn(async () => ({ workId: 'work_1', editionId: 'edition_1', copyId: 'manifestation_1' })),
  readOfficeEntries: vi.fn(async () => []),
  writeConfirmedValues: vi.fn(),
}))
vi.mock('./repository', () => ({
  readShelfDocument: vi.fn(),
  shelfNameHasEntry: vi.fn(async () => false),
  visibleOfficeDocuments: vi.fn(),
}))
vi.mock('./mark', () => ({ markCopyPoints: vi.fn(async () => true) }))
vi.mock('@/lib/sharing/directory', () => ({ loadOrganizationDirectory: vi.fn(async () => new Map([['user-1', { name: 'Anna Berger' }]])) }))
vi.mock('./folders', () => ({
  isStandardsFolder: vi.fn(async (_session: unknown, folderId: string) => folderId === 'folder-brandschutz'),
  standardsFolderRows: vi.fn(async () => ({
    root: { id: 'folder-root', parentId: null, name: 'Grundlagen des Büros', path: 'Grundlagen des Büros' },
    folders: [{ id: 'folder-brandschutz', parentId: 'folder-root', name: 'Brandschutz', path: 'Grundlagen des Büros/Brandschutz' }],
  })),
  standardsRoot: vi.fn(async () => ({ id: 'folder-root' })),
}))
vi.mock('../http/idempotency', () => ({ forgetKeysFor: vi.fn(async () => true) }))
vi.mock('./text-effects', () => ({ withholdText: vi.fn(async () => true), releaseText: vi.fn() }))
vi.mock('@/lib/office-shelf/service', () => ({ deleteOfficeShelfDocument: vi.fn(), uploadOfficeShelfDocument: vi.fn() }))
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
import { deleteOfficeShelfDocument, uploadOfficeShelfDocument } from '@/lib/office-shelf/service'
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
import { readShelfDocument, shelfNameHasEntry, visibleOfficeDocuments } from './repository'
import { STUB_PLATFORM_KNOWLEDGE, usePlatformKnowledge } from '../platform'
import { releaseText, withholdText } from './text-effects'
import { forgetKeysFor } from '../http/idempotency'
import {
  baseKnowledgeForTurn,
  confirmBaseKnowledge,
  listBaseKnowledge,
  proposeBaseKnowledge,
  removeBaseKnowledge,
  setBaseKnowledgeLicence,
  updateBaseKnowledge,
  uploadBaseKnowledge,
} from './service'
import { updateEntryBodySchema } from '../wire'
import { baseKnowledgeOperations } from '@/lib/agent-api/catalog/base-knowledge'
import { BASE_KNOWLEDGE_EXPOSURE } from '@/lib/agent-api/exposure-base-knowledge'

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
const MEMBER: AuthorizedSession = { ...MANAGER, permissions: [] }

const DOCUMENT = { id: 'doc-1', fileName: 'ÖNORM B 1600.pdf', collectionName: 'archiv_org-1', storedName: 'ÖNORM B 1600.pdf', folderId: null }

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
  // The platform's records are their own spec's (`platform/*.integration.spec.ts`); here the platform answers nothing.
  usePlatformKnowledge(STUB_PLATFORM_KNOWLEDGE)
})

describe('who may do what', () => {
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
    vi.mocked(readShelfDocument).mockResolvedValue({ ...DOCUMENT, fileName: 'scan.pdf' })
    await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1', designation: 'ÖNORM B 1600:2017', editionLabel: '2017-04-01' }, 'agent')
    expect(insertProposedEntry).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ designation: 'ÖNORM B 1600:2017', editionLabel: '2017-04-01', title: 'scan' }),
      expect.objectContaining({ organizationId: 'org-1', provenance: { proposedBy: 'agent' } }),
    )
  })

  it('takes a licensed copy’s passages out of the index at once: metadata-only until the AI statement', async () => {
    vi.mocked(readShelfDocument).mockResolvedValue({ ...DOCUMENT, fileName: 'ÖNORM B 1600.pdf' })
    await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1', licenceClass: 'licensed' })
    expect(withholdText).toHaveBeenCalledWith(MANAGER, 'doc-1')
  })

  it('holds even a public copy’s text until a person confirms it, and proposes from the file name alone', async () => {
    vi.mocked(readShelfDocument).mockResolvedValue({ ...DOCUMENT, fileName: 'MA37_Weisung.pdf' })
    await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1' })
    expect(withholdText).toHaveBeenCalledWith(MANAGER, 'doc-1')
    expect(insertProposedEntry).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ designation: null, kind: 'authority_directive' }),
      expect.anything(),
    )
  })

  it('refuses a second entry for one document', async () => {
    vi.mocked(readShelfDocument).mockResolvedValue({ ...DOCUMENT, fileName: 'scan.pdf' })
    vi.mocked(documentHasEntry).mockResolvedValue(true)
    await expect(proposeBaseKnowledge(MANAGER, { documentId: 'doc-1' })).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('uploading as base knowledge', () => {
  it('records the proposal before the dispatch, so the dispatch finds the text held', async () => {
    const order: string[] = []
    vi.mocked(insertProposedEntry).mockImplementation(async () => {
      order.push('proposal')
      return { workId: 'work_1', editionId: 'edition_1', copyId: 'manifestation_1' }
    })
    vi.mocked(uploadOfficeShelfDocument).mockImplementation(async (_session, _file, _request, input) => {
      await input?.beforeDispatch?.('doc-1')
      order.push('dispatch')
      return { documentId: 'doc-1', jobId: null, status: 'stored', filename: 'ÖNORM B 1600.pdf' }
    })
    const file = new File(['%PDF'], 'ÖNORM B 1600.pdf', { type: 'application/pdf' })
    await uploadBaseKnowledge(MANAGER, file, new Request('http://localhost/api/base-knowledge/upload'))
    expect(order).toEqual(['proposal', 'dispatch'])
    expect(insertProposedEntry).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({ designation: 'ÖNORM B 1600', kind: 'technical_standard' }),
      expect.objectContaining({ provenance: { proposedBy: 'reading' } }),
    )
  })

  it('refuses a name a recorded copy already holds before writing any bytes', async () => {
    vi.mocked(shelfNameHasEntry).mockResolvedValueOnce(true)
    const upload = uploadBaseKnowledge(MANAGER, new File(['%PDF'], 'ÖNORM B 1600.pdf'), new Request('http://localhost/x'))
    await expect(upload).rejects.toBeInstanceOf(ConflictError)
    expect(uploadOfficeShelfDocument).not.toHaveBeenCalled()
  })

  it('proposes the stored document when the shelf already held these bytes', async () => {
    vi.mocked(uploadOfficeShelfDocument).mockResolvedValue({
      documentId: 'doc-1',
      jobId: null,
      status: 'uploaded',
      filename: 'ÖNORM B 1600.pdf',
      unchanged: true,
    })
    vi.mocked(readShelfDocument).mockResolvedValue({ ...DOCUMENT, fileName: 'ÖNORM B 1600.pdf' })
    await uploadBaseKnowledge(MANAGER, new File(['%PDF'], 'ÖNORM B 1600.pdf'), new Request('http://localhost/x'))
    expect(insertProposedEntry).toHaveBeenCalled()
    expect(withholdText).toHaveBeenCalledWith(MANAGER, 'doc-1')
  })
})

describe('where an upload lands', () => {
  it('files into the base-knowledge root when no folder is given', async () => {
    vi.mocked(uploadOfficeShelfDocument).mockResolvedValue({ documentId: 'doc-1', jobId: null, status: 'stored', filename: 'a.pdf' })
    vi.mocked(readShelfDocument).mockResolvedValue(DOCUMENT)
    await uploadBaseKnowledge(MANAGER, new File(['%PDF'], 'a.pdf'), new Request('http://localhost/x'))
    expect(uploadOfficeShelfDocument).toHaveBeenCalledWith(MANAGER, expect.anything(), expect.anything(), expect.objectContaining({ folderId: 'folder-root' }))
  })

  it('refuses a folder outside the base knowledge before writing any bytes', async () => {
    const upload = uploadBaseKnowledge(MANAGER, new File(['%PDF'], 'a.pdf'), new Request('http://localhost/x'), { folderId: 'folder-letters' })
    await expect(upload).rejects.toBeInstanceOf(UnprocessableError)
    expect(uploadOfficeShelfDocument).not.toHaveBeenCalled()
  })
})

describe('listing', () => {
  const confirmed = (id: string, documentId: string, lastCheck: StoredEntry['lastCheck']) =>
    stored({ workId: id, documentId, confirmed: true, provenance: { proposedBy: 'person', confirmedBy: 'user-1' }, lastCheck })

  beforeEach(() => {
    const fresh = { checkedAt: new Date().toISOString(), checkedBy: 'user-1', result: 'current' as const, note: null }
    vi.mocked(readOfficeEntries).mockResolvedValue([
      confirmed('work_fresh', 'doc-fresh', fresh),
      stored({ workId: 'work_proposed', documentId: 'doc-proposed' }),
      confirmed('work_due', 'doc-due', null),
    ])
    vi.mocked(visibleOfficeDocuments).mockResolvedValue(
      new Map([
        ['doc-fresh', { ...DOCUMENT, id: 'doc-fresh', folderId: 'folder-brandschutz' }],
        ['doc-proposed', { ...DOCUMENT, id: 'doc-proposed', folderId: 'folder-root' }],
        ['doc-due', { ...DOCUMENT, id: 'doc-due', folderId: null }],
      ]),
    )
  })

  it('puts what needs a person first and counts what needs what', async () => {
    const list = await listBaseKnowledge(MEMBER)
    expect(list.entries.map((entry) => entry.id)).toEqual(['work_proposed', 'work_due', 'work_fresh'])
    expect(list.counts).toEqual({ all: 3, proposed: 1, checkDue: 1, metadataOnly: 2 })
    expect(list.entries[2]).toMatchObject({ folderId: 'folder-brandschutz', confirmedByName: 'Anna Berger' })
  })

  it('narrows to a folder with its subfolders, counting only there', async () => {
    const list = await listBaseKnowledge(MEMBER, { folderId: 'folder-root' })
    expect(list.entries.map((entry) => entry.id)).toEqual(['work_proposed', 'work_fresh'])
    expect(list.counts.all).toBe(2)
  })

  it('narrows by attention without changing the counts', async () => {
    const list = await listBaseKnowledge(MEMBER, { attention: 'check_due' })
    expect(list.entries.map((entry) => entry.id)).toEqual(['work_due'])
    expect(list.counts.all).toBe(3)
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
      expect.objectContaining({ firstCheck: true, provenance: { proposedBy: 'reading', confirmedBy: 'user-1' } }),
    )
  })

  it('keeps who proposed the entry beside who confirmed it', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([stored({ confirmed: true, provenance: { proposedBy: 'agent', confirmedBy: 'user-1' } })])
    const entry = await updateBaseKnowledge(MANAGER, 'work_1', { editionLabel: '2017-05-01' })
    expect(writeConfirmedValues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ provenance: { proposedBy: 'agent', confirmedBy: 'user-1' } }),
    )
    expect(entry).toMatchObject({ proposedBy: 'agent', confirmedBy: 'user-1' })
  })

  it('names nobody as confirming a proposal', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([stored()])
    const { entries } = await listBaseKnowledge(MANAGER, {})
    expect(entries[0]).toMatchObject({ proposedBy: 'reading', confirmedBy: null })
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

  it('releases a public copy’s text once a person confirms it', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([stored({ values: { ...stored().values, licenceClass: 'public_open' } })])
    await confirmBaseKnowledge(MANAGER, 'work_1', {})
    expect(releaseText).toHaveBeenCalledWith(MANAGER, 'doc-1')
    expect(withholdText).not.toHaveBeenCalled()
  })

  it('refuses to confirm twice', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([stored({ confirmed: true })])
    await expect(confirmBaseKnowledge(MANAGER, 'work_1', { licenceAttested: true })).rejects.toBeInstanceOf(ConflictError)
  })
})

describe('the licence, the person’s call alone', () => {
  it('takes no licence and no statement through an edit', () => {
    expect(updateEntryBodySchema.safeParse({ aiProcessingAttested: true }).success).toBe(false)
    expect(updateEntryBodySchema.safeParse({ licenceClass: 'public_open' }).success).toBe(false)
    expect(updateEntryBodySchema.safeParse({ editionLabel: '2017-05-01' }).success).toBe(true)
  })

  it('leaves the text where it is when an edit changes a descriptive value', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([stored({ confirmed: true })])
    await updateBaseKnowledge(MANAGER, 'work_1', { editionLabel: '2017-05-01' })
    expect(writeConfirmedValues).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ editionLabel: '2017-05-01', licenceClass: 'licensed' }),
      expect.objectContaining({ terms: {} }),
    )
    expect(releaseText).not.toHaveBeenCalled()
  })

  it('releases the text only through the licence, and says who stated it', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([stored({ confirmed: true })])
    await setBaseKnowledgeLicence(MANAGER, 'work_1', { aiProcessingAttested: true })
    expect(writeConfirmedValues).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ terms: expect.objectContaining({ aiProcessingAttestedBy: 'user-1' }) }),
    )
    expect(releaseText).toHaveBeenCalledWith(MANAGER, 'doc-1')
  })

  it('is a decision only the person makes through the door', () => {
    for (const name of ['base-knowledge-licence-set', 'base-knowledge-confirm'] as const) {
      expect(baseKnowledgeOperations.find((op) => op.name === name)).toMatchObject({ personDecides: true })
      expect(BASE_KNOWLEDGE_EXPOSURE[name]).toMatchObject({ external: true, agent: false })
    }
  })
})

describe('removing', () => {
  const request = new Request('http://localhost/api/base-knowledge/work_1', { method: 'DELETE' })

  it('runs the office shelf’s own delete, which takes the records with it, and forgets the kept answers', async () => {
    vi.mocked(deleteOfficeShelfDocument).mockResolvedValue({ database: 'removed', search: 'removed', objects: 'removed' })
    expect(await removeBaseKnowledge(MANAGER, 'work_1', request)).toEqual({
      removed: true,
      stores: { database: 'removed', search: 'removed', objects: 'removed', records: 'removed', caches: 'removed' },
    })
    expect(deleteOfficeShelfDocument).toHaveBeenCalledWith(MANAGER, 'doc-1', request)
    expect(forgetKeysFor).toHaveBeenCalledWith('org-1', ['work_1', 'doc-1'])
  })

  it('does not say removed when the kept answers could not be dropped', async () => {
    vi.mocked(deleteOfficeShelfDocument).mockResolvedValue({ database: 'removed', search: 'removed', objects: 'removed' })
    vi.mocked(forgetKeysFor).mockResolvedValueOnce(false)
    const receipt = await removeBaseKnowledge(MANAGER, 'work_1', request)
    expect(receipt).toMatchObject({ removed: false, stores: { caches: 'failed' } })
  })

  it('does not say removed when the search purge was not confirmed', async () => {
    vi.mocked(deleteOfficeShelfDocument).mockResolvedValue({ database: 'removed', search: 'failed', objects: 'removed' })
    const receipt = await removeBaseKnowledge(MANAGER, 'work_1', request)
    expect(receipt.removed).toBe(false)
    expect(receipt.stores.search).toBe('failed')
  })
})

describe('the turn', () => {
  it('reads the office’s entries for every organization, with no switch to ask (ADR-0175)', async () => {
    vi.mocked(isOrgFeatureEnabled).mockResolvedValue(false)
    await baseKnowledgeForTurn('org-1', 'proj-1')
    expect(readOfficeEntries).toHaveBeenCalledWith('org-1')
  })

  it('carries confirmed entries, and a licensed proposal as listed only and never as a label (A7)', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValue([
      stored({ confirmed: true }),
      stored({ workId: 'work_2', documentId: 'doc-1', confirmed: false }),
      stored({ workId: 'work_3', documentId: 'doc-1', confirmed: false, values: { ...stored().values, licenceClass: 'public_open' } }),
    ])
    vi.mocked(findProjectProfileInOrg).mockResolvedValue({
      profile: { facts: { federal_state: { value: 'vienna' } } },
    } as unknown as Awaited<ReturnType<typeof findProjectProfileInOrg>>)
    const turn = await baseKnowledgeForTurn('org-1', 'proj-1')
    expect(turn?.block?.split('\n')).toHaveLength(3)
    expect(turn?.block?.split('\n')[2]).toContain('licensed copy, not yet confirmed; LISTED ONLY, NOT READ')
    expect(turn?.labels).toEqual([
      expect.objectContaining({ documentId: 'doc-1', holder: 'office', role: 'requirement_source', editionLabel: '2017-04-01' }),
    ])
  })

  it('names what the platform lists and the office does not hold, through the one platform interface', async () => {
    const previous = usePlatformKnowledge({
      ...STUB_PLATFORM_KNOWLEDGE,
      listedNotHeld: async (_organizationId, held) =>
        held.includes('ÖNORM B 5371:2021')
          ? []
          : [{ designation: 'ÖNORM B 5371:2021', title: 'Treppen', editionLabel: '2021-01-15', hasText: false }],
    })
    try {
      vi.mocked(readOfficeEntries).mockResolvedValue([])
      const turn = await baseKnowledgeForTurn('org-2', null)
      expect(turn?.block).toContain('ÖNORM B 5371:2021 „Treppen“: listed by the platform')
      expect(turn?.block).toContain('gelistet, kein Text')
      expect(turn?.labels).toEqual([])
    } finally {
      usePlatformKnowledge(previous)
    }
  })
})

describe('the platform directives in a turn', () => {
  it('carries a platform directive that applies, and none that is excluded for the project', async () => {
    const seen: (string | null)[] = []
    const previous = usePlatformKnowledge({
      ...STUB_PLATFORM_KNOWLEDGE,
      directivesFor: async (_organizationId, territoryId) => {
        seen.push(territoryId)
        return [
          {
            title: 'Stellplatzregulativ',
            designation: null,
            editionLabel: '2024',
            authorities: ['Bau- und Anlagenbehörde Graz'],
            verdict: { verdict: 'applies', authority: 'Bau- und Anlagenbehörde Graz', territoryId: 'AT-6' },
          },
        ]
      },
    })
    try {
      vi.mocked(readOfficeEntries).mockResolvedValue([])
      vi.mocked(findProjectProfileInOrg).mockResolvedValue({
        profile: { facts: { federal_state: { value: 'styria' } } },
      } as unknown as Awaited<ReturnType<typeof findProjectProfileInOrg>>)
      const turn = await baseKnowledgeForTurn('org-2', 'project-graz')
      expect(seen).toEqual(['AT-6'])
      expect(turn?.block).toContain('„Stellplatzregulativ“: authority practice of Bau- und Anlagenbehörde Graz, published by the platform')
      expect(turn?.block).toContain('applies to this project')
    } finally {
      usePlatformKnowledge(previous)
    }
  })
})
