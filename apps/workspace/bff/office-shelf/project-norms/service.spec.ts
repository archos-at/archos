/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/access', () => ({ getAccessibleDocument: vi.fn() }))
vi.mock('@/lib/documents/shelf-authz', () => ({ requireShelfRead: vi.fn(async () => undefined) }))
vi.mock('@/lib/authz/folder-access', () => ({
  canWriteFolder: vi.fn(async () => true),
  getProjectFolderAccess: vi.fn(async () => ({ isVisible: () => true })),
  filterUsersWhoMayWriteFolder: vi.fn(async (_org: string, _project: string, _folder: string | null, users: string[]) => new Set(users)),
}))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg: vi.fn(async () => ({ id: 'project-1', name: 'Wohnhaus Floridsdorf', collectionName: 'p1' })) }))
vi.mock('@/lib/proposals/repository', () => ({
  insertProposedChange: vi.fn(async () => ({ row: { id: 'proposal-1' }, created: true })),
  listShelfProposals: vi.fn(async () => []),
}))
vi.mock('@/lib/proposals/audit', () => ({ auditProposalCreated: vi.fn() }))
vi.mock('./managers', () => ({ normDecidersOf: vi.fn(async () => ({ deciders: ['user-manager'], managers: ['Bernd Huber'] })) }))
vi.mock('./held-works', () => ({ heldWorks: vi.fn(async () => new Map()) }))
vi.mock('@/lib/documents/stored-copy', () => ({
  storedFileOf: vi.fn(async (_file: unknown, name: string) => new File([new Uint8Array([1])], name, { type: 'application/pdf' })),
}))
vi.mock('@/lib/pdf/cover-text', () => ({ readCoverText: vi.fn(async () => null) }))
vi.mock('./repository', () => ({
  keepInProject: vi.fn(async () => undefined),
  keptAmong: vi.fn(async () => new Set()),
  listProjectNormRows: vi.fn(async () => []),
  listReferences: vi.fn(async () => []),
  insertReference: vi.fn(),
}))
vi.mock('@/lib/inbox/best-effort', () => ({
  bestEffortInbox: async (_label: string, _organizationId: string, write: () => Promise<unknown>) => {
    await write()
  },
}))
vi.mock('@/lib/inbox/service', () => ({ emitInboxItems: vi.fn(async () => undefined), resolveInboxItemsAnchoredOn: vi.fn(async () => 0) }))
vi.mock('@/lib/base-knowledge/store/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/base-knowledge/store/repository')>()),
  entryIdsForDocuments: vi.fn(
    async (_org: string, ids: string[]) => new Map(ids.filter((id) => id !== 'office-doc-unlisted').map((id) => [id, `entry-of-${id}`]))
  ),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import type { Document } from '@/lib/db/schema/documents'
import type { OfficeShelfReference } from '@/lib/db/schema/office-shelf-references'
import { getAccessibleDocument } from '@/lib/documents/access'
import { insertProposedChange, listShelfProposals } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/proposals/repository'
import { emitInboxItems, resolveInboxItemsAnchoredOn } from '@/lib/inbox/service'
import { readCoverText } from '@/lib/pdf/cover-text'
import { heldWorks } from './held-works'
import { normDecidersOf } from './managers'
import { workKey, type HeldEdition } from './placement'
import { keepInProject, keptAmong, listProjectNormRows, listReferences, type ProjectNormRow } from './repository'
import { listProjectNorms, placeProjectNorms } from './service'

const MEMBER: AuthorizedSession = {
  userId: 'user-1',
  email: 'anna@example.com',
  name: 'Anna Berger',
  accessToken: 'token',
  organizationId: 'org-1',
  organizationMembershipId: 'om-1',
  role: 'member',
  permissions: [],
  featureFlags: [],
}
const MANAGER: AuthorizedSession = { ...MEMBER, permissions: [ORG_PERMISSIONS.officeShelfManage] }
const REQUEST = new Request('http://localhost/api/projects/project-1/norms', { method: 'POST' })

function document(id: string, filename: string): Document {
  return {
    id,
    organizationId: 'org-1',
    projectId: 'project-1',
    scope: 'project',
    folderId: 'folder-normen',
    filename,
    displayName: null,
    status: 'completed',
    authoredBy: 'user',
    screeningOutcome: 'clean',
    contentHash: 'h',
    screenedHash: 'h',
  } as unknown as Document
}

function normRow(id: string, filename: string, contentHash = 'h'): ProjectNormRow {
  return {
    id,
    filename,
    displayName: null,
    folderId: null,
    status: 'completed',
    authoredBy: 'user',
    screeningOutcome: 'clean',
    contentHash,
    screenedHash: contentHash,
    createdBy: 'user-1',
    storageBucket: null,
    storageKey: `org-1/${id}`,
    contentType: 'application/pdf',
    fileSize: 1000,
  }
}

function heldEdition(editionLabel: string): HeldEdition {
  return {
    entry: {
      editionId: `edition-${editionLabel}`,
      documentId: `office-${editionLabel}`,
      createdAt: new Date('2026-01-01'),
      values: {
        kind: 'technical_standard',
        title: 'Barrierefreies Bauen',
        designation: 'ÖNORM B 1600',
        editionLabel,
        issuedOn: editionLabel,
        inForceFrom: null,
        inForceTo: null,
        territoryIds: [],
        issuer: null,
        addressees: [],
        licenceClass: 'public_open',
      },
    },
    contentHash: `office-${editionLabel}`,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(heldWorks).mockResolvedValue(new Map())
  vi.mocked(readCoverText).mockResolvedValue(null)
  vi.mocked(normDecidersOf).mockResolvedValue({ deciders: ['user-manager'], managers: ['Bernd Huber'] })
  vi.mocked(listShelfProposals).mockResolvedValue([])
  vi.mocked(keptAmong).mockResolvedValue(new Set())
  vi.mocked(listProjectNormRows).mockResolvedValue([])
  vi.mocked(listReferences).mockResolvedValue([])
  vi.mocked(getAccessibleDocument).mockImplementation(async (_session, id) => document(id, `OENORM_B_X${id[0]}.pdf`))
})

describe('without the right to manage the office shelf, a norm is suggested', () => {
  it('records one suggestion by the person and puts it in the inbox of those who may decide it', async () => {
    const placed = await placeProjectNorms(
      MEMBER,
      'project-1',
      { destination: 'suggest', visibility: 'office', documents: [{ documentId: '11111111-1111-4111-8111-111111111111' }, { documentId: '22222222-2222-4222-8222-222222222222' }] },
      REQUEST
    )
    expect(insertProposedChange).toHaveBeenCalledTimes(1)
    expect(vi.mocked(insertProposedChange).mock.calls[0][0]).toMatchObject({
      projectId: 'project-1',
      scope: 'project',
      kind: 'office_shelf_norm',
      proposedByKind: 'person',
      onBehalfOf: 'user-1',
      payload: { documents: [{ id: '11111111-1111-4111-8111-111111111111', name: 'OENORM_B_X1.pdf' }, { id: '22222222-2222-4222-8222-222222222222', name: 'OENORM_B_X2.pdf' }] },
    })
    expect(normDecidersOf).toHaveBeenCalledWith('org-1', 'project-1', ['folder-normen', 'folder-normen'], 'user-1')
    const [emissions] = vi.mocked(emitInboxItems).mock.calls[0]
    expect(emissions).toEqual([
      expect.objectContaining({
        recipientUserId: 'user-manager',
        type: 'office_shelf.norm_suggested',
        resourceType: 'project',
        resourceId: 'project-1',
        anchorId: 'proposal-1',
        actorUserId: 'user-1',
        payload: expect.objectContaining({ subject: 'Wohnhaus Floridsdorf', folderId: 'folder-normen' }),
      }),
    ])
    expect(resolveInboxItemsAnchoredOn).not.toHaveBeenCalled()
    expect(placed).toMatchObject({ destination: 'suggest', visibility: 'office', notified: 1, noDecider: null })
    expect(placed.placements.map((placement) => [placement.outcome, placement.proposalId])).toEqual([
      ['suggested', 'proposal-1'],
      ['suggested', 'proposal-1'],
    ])
  })

  it('records nothing when nobody may decide it, and says who manages the office shelf', async () => {
    vi.mocked(normDecidersOf).mockResolvedValue({ deciders: [], managers: ['Bernd Huber'] })
    const placed = await placeProjectNorms(
      MEMBER,
      'project-1',
      { destination: 'suggest', visibility: 'office', documents: [{ documentId: '11111111-1111-4111-8111-111111111111' }] },
      REQUEST
    )
    expect(insertProposedChange).not.toHaveBeenCalled()
    expect(emitInboxItems).not.toHaveBeenCalled()
    expect(resolveInboxItemsAnchoredOn).not.toHaveBeenCalled()
    expect(placed).toMatchObject({ notified: 0, noDecider: { managers: ['Bernd Huber'] } })
    expect(placed.placements).toMatchObject([{ documentId: '11111111-1111-4111-8111-111111111111', outcome: 'refused', proposalId: null }])
  })

  it('keeps the values the person saw in the suggestion, for whoever decides it', async () => {
    await placeProjectNorms(
      MEMBER,
      'project-1',
      {
        destination: 'suggest',
        visibility: 'office',
        documents: [
          { documentId: '11111111-1111-4111-8111-111111111111', values: { kind: 'guideline', designation: 'RVS 03.01', editionLabel: '2024-05' } },
          { documentId: '22222222-2222-4222-8222-222222222222' },
        ],
      },
      REQUEST
    )
    expect(vi.mocked(insertProposedChange).mock.calls[0][0].payload).toEqual({
      documents: [
        { id: '11111111-1111-4111-8111-111111111111', name: 'OENORM_B_X1.pdf', designation: 'RVS 03.01', kind: 'guideline', editionLabel: '2024-05' },
        { id: '22222222-2222-4222-8222-222222222222', name: 'OENORM_B_X2.pdf', designation: null, kind: 'technical_standard', editionLabel: null },
      ],
    })
  })

  it('does not suggest a norm twice while its suggestion is open', async () => {
    vi.mocked(listShelfProposals).mockResolvedValue([
      { id: 'proposal-open', payload: { documents: [{ id: '11111111-1111-4111-8111-111111111111', name: 'OENORM_B_X1.pdf', designation: null }] } } as unknown as ProposedChangeRow,
    ])
    const placed = await placeProjectNorms(MEMBER, 'project-1', { destination: 'suggest', visibility: 'office', documents: [{ documentId: '11111111-1111-4111-8111-111111111111' }] }, REQUEST)
    expect(insertProposedChange).not.toHaveBeenCalled()
    expect(placed.placements[0]).toMatchObject({ outcome: 'suggested', proposalId: 'proposal-open' })
  })

  it('refuses to move it straight into the office shelf', async () => {
    const placed = await placeProjectNorms(MEMBER, 'project-1', { destination: 'office_shelf', visibility: 'office', documents: [{ documentId: '11111111-1111-4111-8111-111111111111' }] }, REQUEST).catch((error: unknown) => error)
    expect(placed).toMatchObject({ status: 403 })
  })
})

describe('„Hier lassen“', () => {
  it('remembers per document that the norm stays in the project, and leaves the Postfach alone', async () => {
    const placed = await placeProjectNorms(MANAGER, 'project-1', { destination: 'project', documents: [{ documentId: '11111111-1111-4111-8111-111111111111' }] }, REQUEST)
    expect(getAccessibleDocument).toHaveBeenCalledWith(MANAGER, '11111111-1111-4111-8111-111111111111', 'write')
    expect(keepInProject).toHaveBeenCalledWith('org-1', 'project-1', ['11111111-1111-4111-8111-111111111111'], 'user-1')
    expect(resolveInboxItemsAnchoredOn).not.toHaveBeenCalled()
    expect(placed).toMatchObject({ visibility: 'project', placements: [{ documentId: '11111111-1111-4111-8111-111111111111', outcome: 'kept' }] })
  })
})

describe('the project’s view of its norms', () => {
  it('offers the norms nobody kept, and never again one that was kept', async () => {
    vi.mocked(listProjectNormRows).mockResolvedValue([normRow('11111111-1111-4111-8111-111111111111', 'OENORM_B_1600.pdf'), normRow('22222222-2222-4222-8222-222222222222', 'OENORM_B_2320.pdf'), normRow('33333333-3333-4333-8333-333333333333', 'Grundriss.pdf')])
    vi.mocked(keptAmong).mockResolvedValue(new Set(['22222222-2222-4222-8222-222222222222']))
    const listed = await listProjectNorms(MANAGER, 'project-1', {})
    expect(listed.offers.map((offer) => offer.documentId)).toEqual(['11111111-1111-4111-8111-111111111111'])
    expect(listed.canManageOfficeShelf).toBe(true)
  })

  it('prefills the edition its cover page gives where the file name gives none', async () => {
    vi.mocked(listProjectNormRows).mockResolvedValue([normRow('11111111-1111-4111-8111-111111111111', 'OENORM_B_1600.pdf', 'cover-only')])
    vi.mocked(readCoverText).mockResolvedValue('ÖNORM B 1600\nBarrierefreies Bauen\nAusgabe: 2023-02-01')
    const [offer] = (await listProjectNorms(MANAGER, 'project-1', {})).offers
    expect(offer).toMatchObject({ designation: 'ÖNORM B 1600', editionLabel: '2023-02-01' })
  })

  it('offers a newer edition of a norm the office holds, with the designation and edition its cover page gives', async () => {
    vi.mocked(heldWorks).mockResolvedValue(new Map([[workKey('ÖNORM B 1600')!, [heldEdition('2017-04-15')]]]))
    vi.mocked(listProjectNormRows).mockResolvedValue([
      normRow('11111111-1111-4111-8111-111111111111', 'B1600_neu.pdf', 'cover-newer'),
      normRow('22222222-2222-4222-8222-222222222222', 'OENORM_B_1600_2017-04-15.pdf', 'cover-same'),
    ])
    vi.mocked(readCoverText).mockImplementation(async (file) =>
      (file as File).name === 'B1600_neu.pdf' ? 'ÖNORM B 1600\nBarrierefreies Bauen\nAusgabe: 2023-02-01' : null
    )
    const listed = await listProjectNorms(MANAGER, 'project-1', {})
    expect(listed.offers).toEqual([
      {
        documentId: '11111111-1111-4111-8111-111111111111',
        fileName: 'B1600_neu.pdf',
        folderId: null,
        designation: 'ÖNORM B 1600',
        kind: 'technical_standard',
        editionLabel: '2023-02-01',
      },
    ])
  })

  it('does not offer again a norm whose suggestion was declined', async () => {
    vi.mocked(listProjectNormRows).mockResolvedValue([normRow('11111111-1111-4111-8111-111111111111', 'OENORM_B_1600.pdf')])
    vi.mocked(listShelfProposals).mockResolvedValue([
      { id: 'proposal-dismissed', payload: { documents: [{ id: '11111111-1111-4111-8111-111111111111', name: 'OENORM_B_1600.pdf', designation: null }] } } as unknown as ProposedChangeRow,
    ])
    expect((await listProjectNorms(MEMBER, 'project-1', {})).offers).toEqual([])
    expect(vi.mocked(listShelfProposals).mock.calls[0][2]).toMatchObject({ statuses: ['proposed', 'dismissed'], kind: 'office_shelf_norm' })
  })

  it('shows a reference whose office shelf copy was deleted as removed, and names the entry of a copy still there', async () => {
    const reference = (id: string, officeDocumentId: string | null): OfficeShelfReference => ({
      id,
      organizationId: 'org-1',
      projectId: 'project-1',
      folderId: null,
      sourceDocumentId: `source-${id}`,
      officeDocumentId,
      fileName: `${id}.pdf`,
      placedAs: 'moved',
      createdBy: 'user-1',
      createdAt: new Date('2026-11-19T10:00:00Z'),
    })
    vi.mocked(listReferences).mockResolvedValue([reference('kept', 'office-doc-1'), reference('unlisted', 'office-doc-unlisted'), reference('gone', null)])
    const listed = await listProjectNorms(MEMBER, 'project-1', {})
    expect(listed.references.map((row) => [row.id, row.state, row.officeDocumentId, row.entryId])).toEqual([
      ['kept', 'in_office_shelf', 'office-doc-1', 'entry-of-office-doc-1'],
      ['unlisted', 'unlisted', 'office-doc-unlisted', null],
      ['gone', 'removed', null, null],
    ])
    expect(listed.nextCursor).toBeNull()
  })
})
