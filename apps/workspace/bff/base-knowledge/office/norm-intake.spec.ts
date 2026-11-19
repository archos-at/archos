import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/office-shelf/service', () => ({ uploadOfficeShelfDocument: vi.fn() }))
vi.mock('@/lib/documents/move-to-folder', () => ({ moveDocumentToFolder: vi.fn(async () => ({ ok: true })) }))
vi.mock('../store/repository', () => ({ readOfficeEntries: vi.fn(async () => []) }))
vi.mock('./folders', () => ({
  standardsRoot: vi.fn(async () => ({ id: 'folder-root' })),
  isStandardsFolder: vi.fn(async (_session: unknown, folderId: string) => folderId === 'folder-root' || folderId === 'topic-fire'),
}))
vi.mock('./service', () => ({ recordProposal: vi.fn(async () => 'edition_new') }))
vi.mock('./text-effects', () => ({ withholdText: vi.fn(async () => true) }))

import { UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { uploadOfficeShelfDocument } from '@/lib/office-shelf/service'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import { takeAsNorm, uploadToOfficeShelf } from './norm-intake'
import { recordProposal } from './service'
import { withholdText } from './text-effects'

const MANAGER = {
  userId: 'user-1',
  organizationId: 'org-1',
  permissions: [ORG_PERMISSIONS.officeShelfManage],
  featureFlags: ['office-standards'],
} as unknown as AuthorizedSession

const request = new Request('http://localhost/api/documents/upload', { method: 'POST' })
const pdf = (name: string) => new File(['%PDF'], name, { type: 'application/pdf' })

const B1600 = {
  workId: 'work_b1600',
  editionId: 'edition_b1600',
  documentId: 'doc-b1600',
  confirmed: true,
  values: { designation: 'ÖNORM B 1600', editionLabel: '2017-04-01', issuedOn: '2017-04-01', inForceFrom: null },
} as unknown as StoredEntry

afterEach(() => vi.unstubAllEnvs())

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  vi.mocked(uploadOfficeShelfDocument).mockImplementation(async (_session, file, _request, input) => {
    await input?.beforeDispatch?.('doc-new')
    return { documentId: 'doc-new', jobId: null, status: 'stored', filename: file.name }
  })
})

describe('an upload to the Büroablage', () => {
  it('takes a norm out of the Ordner before its text is read: it lands under the standards root and its proposal names the folder it was meant for', async () => {
    await uploadToOfficeShelf(MANAGER, pdf('OENORM_B_8110-3_2020-03-15_de.pdf'), request, { folderId: 'folder-plans', uploadBatchId: 'batch-1' })

    expect(uploadOfficeShelfDocument).toHaveBeenCalledWith(
      MANAGER,
      expect.any(File),
      request,
      expect.objectContaining({ folderId: 'folder-root', uploadBatchId: 'batch-1', beforeDispatch: expect.any(Function) }),
    )
    expect(recordProposal).toHaveBeenCalledWith(
      MANAGER,
      { documentId: 'doc-new', designation: 'ÖNORM B 8110-3' },
      'OENORM_B_8110-3_2020-03-15_de.pdf',
      'reading',
      undefined,
      { filedFrom: { folderId: 'folder-plans' } },
    )
  })

  it('remembers the top level as where a norm uploaded there came from', async () => {
    await uploadToOfficeShelf(MANAGER, pdf('MA37_Weisung_Dachgeschoss_2024-09.pdf'), request)

    expect(vi.mocked(uploadOfficeShelfDocument).mock.calls[0][3]).toMatchObject({ folderId: 'folder-root' })
    expect(vi.mocked(recordProposal).mock.calls[0][5]).toEqual({ filedFrom: { folderId: null } })
  })

  it('records a norm whose work the office holds as a new edition of that work', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([B1600])

    await uploadToOfficeShelf(MANAGER, pdf('OENORM_B_1600_2023-02-01_de.pdf'), request)

    expect(vi.mocked(recordProposal).mock.calls[0][4]).toBe(B1600)
  })

  it.each([
    ['an ordinary file', MANAGER, pdf('Haus_A_2024_Einreichung.pdf'), { folderId: 'folder-plans' }],
    ['the platform’s own guideline', MANAGER, pdf('OIB-Richtlinie_2_2023.pdf'), { folderId: 'folder-plans' }],
    ['a norm while the office keeps no standards of its own', { ...MANAGER, featureFlags: [] } as AuthorizedSession, pdf('DIN_4109-1_2018-01.pdf'), { folderId: 'folder-plans' }],
    ['a norm uploaded into the standards tree itself', MANAGER, pdf('DIN_4109-1_2018-01.pdf'), { folderId: 'topic-fire' }],
    ['a norm named as a new version of a file', MANAGER, pdf('DIN_4109-1_2018-01.pdf'), { folderId: 'folder-plans', revisionOf: 'doc-old' }],
  ])('leaves %s where it was uploaded, unrecorded', async (_case, session, file, input) => {
    await uploadToOfficeShelf(session, file, request, input)

    expect(uploadOfficeShelfDocument).toHaveBeenCalledWith(session, file, request, input)
    expect(recordProposal).not.toHaveBeenCalled()
  })
})

describe('taking an Ordner file as a norm', () => {
  const place = { rootId: 'folder-root', entries: [B1600], standards: new Set(['folder-root', 'topic-fire']) }

  it('records the proposal with the folder it came from and withholds its text before it moves it under the standards root', async () => {
    await takeAsNorm(MANAGER, { documentId: 'doc-1', fileName: 'OENORM_B_1600_2023-02-01.pdf', folderId: 'folder-normen', designation: 'ÖNORM B 1600' }, place)

    expect(recordProposal).toHaveBeenCalledWith(
      MANAGER,
      { documentId: 'doc-1', designation: 'ÖNORM B 1600' },
      'OENORM_B_1600_2023-02-01.pdf',
      'reading',
      B1600,
      { filedFrom: { folderId: 'folder-normen' } },
    )
    expect(withholdText).toHaveBeenCalledWith(MANAGER, 'doc-1')
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: 'doc-1', folderId: 'folder-root', expectedFolderId: 'folder-normen' }, MANAGER)
    expect(vi.mocked(recordProposal).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(moveDocumentToFolder).mock.invocationCallOrder[0])
  })

  it('leaves a file that already lies under the standards tree where it lies', async () => {
    await takeAsNorm(MANAGER, { documentId: 'doc-1', fileName: 'Leitfaden.pdf', folderId: 'topic-fire', designation: null }, place)

    expect(vi.mocked(recordProposal).mock.calls[0][5]).toEqual({})
    expect(moveDocumentToFolder).not.toHaveBeenCalled()
  })

  it('says why a file could not be moved', async () => {
    vi.mocked(moveDocumentToFolder).mockResolvedValueOnce({ ok: false, error: 'The document was moved since; it was left where it is.' })

    await expect(
      takeAsNorm(MANAGER, { documentId: 'doc-1', fileName: 'DIN_4109-1.pdf', folderId: null, designation: 'DIN 4109-1' }, place),
    ).rejects.toBeInstanceOf(UnprocessableError)
  })
})
