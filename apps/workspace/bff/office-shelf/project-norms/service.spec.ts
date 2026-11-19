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
vi.mock('./managers', () => ({ normDecidersOf: vi.fn(async () => ['user-manager']) }))
vi.mock('./held-works', () => ({ heldWorks: vi.fn(async () => new Map()) }))
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
vi.mock('@/lib/base-knowledge/office/access', () => ({ officeStandardsEnabled: vi.fn(async () => true) }))
vi.mock('@/lib/auth/pinned-session', () => ({ resolvePinnedRequesterSession: vi.fn() }))
vi.mock('@/lib/upload-batches/repository', () => ({ listBatchDocuments: vi.fn(async () => []) }))
vi.mock('@/lib/base-knowledge/store/repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/base-knowledge/store/repository')>()),
  entryIdsForDocuments: vi.fn(async (_org: string, ids: string[]) => new Map(ids.map((id) => [id, `entry-of-${id}`]))),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { resolvePinnedRequesterSession } from '@/lib/auth/pinned-session'
import type { Document } from '@/lib/db/schema/documents'
import type { OfficeShelfReference } from '@/lib/db/schema/office-shelf-references'
import { getAccessibleDocument } from '@/lib/documents/access'
import { insertProposedChange, listShelfProposals } from '@/lib/proposals/repository'
import type { ProposedChangeRow } from '@/lib/proposals/repository'
import { listBatchDocuments } from '@/lib/upload-batches/repository'
import { emitInboxItems, resolveInboxItemsAnchoredOn } from '@/lib/inbox/service'
import { normDecidersOf } from './managers'
import { keepInProject, keptAmong, listProjectNormRows, listReferences, type ProjectNormRow } from './repository'
import { listProjectNorms, offerNormsAfterSettle, placeProjectNorms } from './service'

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

function normRow(id: string, filename: string): ProjectNormRow {
  return { id, filename, displayName: null, folderId: null, status: 'completed', authoredBy: 'user', screeningOutcome: 'clean', contentHash: 'h', screenedHash: 'h', createdBy: 'user-1' }
}

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(vi.mocked(resolveInboxItemsAnchoredOn).mock.calls.map(([input]) => input.anchorId)).toEqual([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ])
    expect(placed).toMatchObject({ destination: 'suggest', visibility: 'office', notified: 1 })
    expect(placed.placements.map((placement) => [placement.outcome, placement.proposalId])).toEqual([
      ['suggested', 'proposal-1'],
      ['suggested', 'proposal-1'],
    ])
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
  it('remembers per document that the norm stays in the project, and settles its offer', async () => {
    const placed = await placeProjectNorms(MANAGER, 'project-1', { destination: 'project', documents: [{ documentId: '11111111-1111-4111-8111-111111111111' }] }, REQUEST)
    expect(getAccessibleDocument).toHaveBeenCalledWith(MANAGER, '11111111-1111-4111-8111-111111111111', 'write')
    expect(keepInProject).toHaveBeenCalledWith('org-1', 'project-1', ['11111111-1111-4111-8111-111111111111'], 'user-1')
    expect(resolveInboxItemsAnchoredOn).toHaveBeenCalledWith({
      organizationId: 'org-1',
      types: ['office_shelf.norm_offered'],
      anchorId: '11111111-1111-4111-8111-111111111111',
    })
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
    vi.mocked(listReferences).mockResolvedValue([reference('kept', 'office-doc-1'), reference('gone', null)])
    const listed = await listProjectNorms(MEMBER, 'project-1', {})
    expect(listed.references.map((row) => [row.id, row.state, row.entryId])).toEqual([
      ['kept', 'in_office_shelf', 'entry-of-office-doc-1'],
      ['gone', 'removed', null],
    ])
    expect(listed.nextCursor).toBeNull()
  })
})

describe('after an upload settles', () => {
  it('puts the offer of each new project norm in the uploader’s inbox, linked to its folder', async () => {
    vi.mocked(resolvePinnedRequesterSession).mockResolvedValue(MEMBER)
    vi.mocked(listBatchDocuments).mockResolvedValue([document('11111111-1111-4111-8111-111111111111', 'OENORM_B_1600.pdf')])
    vi.mocked(listProjectNormRows).mockResolvedValue([{ ...normRow('11111111-1111-4111-8111-111111111111', 'OENORM_B_1600.pdf'), folderId: 'folder-normen' }])
    await offerNormsAfterSettle('org-1', [{ id: 'batch-1', scope: 'project', projectId: 'project-1', createdBy: 'user-1' }])
    const [emissions] = vi.mocked(emitInboxItems).mock.calls[0]
    expect(emissions).toEqual([
      expect.objectContaining({
        recipientUserId: 'user-1',
        type: 'office_shelf.norm_offered',
        resourceId: 'project-1',
        anchorId: '11111111-1111-4111-8111-111111111111',
        payload: { subject: 'Wohnhaus Floridsdorf', excerpt: 'ÖNORM B 1600', folderId: 'folder-normen' },
      }),
    ])
  })
})
