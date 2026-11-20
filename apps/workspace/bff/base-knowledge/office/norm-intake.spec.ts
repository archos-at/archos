import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/office-shelf/service', () => ({ uploadOfficeShelfDocument: vi.fn() }))
vi.mock('@/lib/documents/move-to-folder', () => ({ moveDocumentToFolder: vi.fn(async () => ({ ok: true })) }))
vi.mock('../store/repository', () => ({ readOfficeEntries: vi.fn(async () => []) }))
vi.mock('./folders', () => ({
  standardsRoot: vi.fn(async () => ({ id: 'folder-root' })),
  standardsFolderRows: vi.fn(async () => ({ root: { id: 'folder-root' }, folders: [{ id: 'topic-fire' }] })),
  isStandardsFolder: vi.fn(async (_session: unknown, folderId: string) => folderId === 'folder-root' || folderId === 'topic-fire'),
}))
vi.mock('./service', () => ({
  recordProposal: vi.fn(async () => 'edition_new'),
  storedEntryOf: vi.fn(async () => ({ entry: { id: 'edition_new' } })),
}))
vi.mock('./text-effects', () => ({ withholdText: vi.fn(async () => true) }))
vi.mock('./folder-norms-repository', () => ({ keepAsOrdinaryFiles: vi.fn() }))
vi.mock('./repository', () => ({ readShelfDocument: vi.fn() }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'member', userId: 'user-1' })) }))

import { NORM_COVERS, normCoverFile } from '@/app/dev/_fixtures/norm-covers'
import { ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { moveDocumentToFolder } from '@/lib/documents/move-to-folder'
import { uploadOfficeShelfDocument } from '@/lib/office-shelf/service'
import { readOfficeEntries, type StoredEntry } from '../store/repository'
import { keepAsOrdinaryFiles } from './folder-norms-repository'
import { proposeBaseKnowledge, takeAsNorm, uploadToOfficeShelf } from './norm-intake'
import { readShelfDocument } from './repository'
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
      { filedFrom: { folderId: 'folder-plans', upload: true } },
    )
  })

  it('remembers the top level as where a norm uploaded there came from', async () => {
    await uploadToOfficeShelf(MANAGER, pdf('MA37_Weisung_Dachgeschoss_2024-09.pdf'), request)

    expect(vi.mocked(uploadOfficeShelfDocument).mock.calls[0][3]).toMatchObject({ folderId: 'folder-root' })
    expect(vi.mocked(recordProposal).mock.calls[0][5]).toEqual({ filedFrom: { folderId: null, upload: true } })
  })

  it('records a norm whose work the office holds as a new edition of that work', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([B1600])

    await uploadToOfficeShelf(MANAGER, pdf('OENORM_B_1600_2023-02-01_de.pdf'), request)

    expect(vi.mocked(recordProposal).mock.calls[0][4]).toBe(B1600)
  })

  it('takes designation, edition and title from the cover page, and finds the held work under a file name spelled otherwise', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([B1600])

    await uploadToOfficeShelf(MANAGER, normCoverFile(NORM_COVERS.onorm, 'OENORM_B1600_neu.pdf'), request)

    const [, body, , , editionOf, provenance] = vi.mocked(recordProposal).mock.calls[0]
    expect(body).toEqual({
      documentId: 'doc-new',
      designation: 'ÖNORM B 1600',
      editionLabel: '2023-02-01',
      issuedOn: '2023-02-01',
      title: 'Barrierefreies Bauen - Planungsgrundlagen',
    })
    expect(editionOf).toBe(B1600)
    expect(provenance?.cover).toMatchObject({ read: { designation: 'cover', editionLabel: 'cover' }, overrode: [] })
  })

  it('records the edition of the cover over a wrong one in the file name, and that they disagreed', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([B1600])

    await uploadToOfficeShelf(MANAGER, normCoverFile(NORM_COVERS.disagrees), request, { folderId: 'folder-plans' })

    const [, body, , , editionOf, provenance] = vi.mocked(recordProposal).mock.calls[0]
    expect(body).toMatchObject({ editionLabel: '2023-02-01', issuedOn: '2023-02-01' })
    expect(editionOf).toBe(B1600)
    expect(provenance).toEqual({
      filedFrom: { folderId: 'folder-plans', upload: true },
      cover: expect.objectContaining({
        overrode: [{ field: 'editionLabel', fileName: '2017-04-01' }],
        replaces: expect.arrayContaining([{ designation: 'ÖNORM B 1600', editionLabel: '2017-04-01' }]),
      }),
    })
  })

  it('reads a scan without text from its file name alone', async () => {
    await uploadToOfficeShelf(MANAGER, normCoverFile(NORM_COVERS.scan), request, { folderId: 'folder-plans' })

    expect(recordProposal).toHaveBeenCalledWith(
      MANAGER,
      { documentId: 'doc-new', designation: 'ÖNORM B 1300' },
      'OENORM_B_1300_2012.pdf',
      'reading',
      undefined,
      { filedFrom: { folderId: 'folder-plans', upload: true } },
    )
  })

  it.each([
    ['an ordinary file', MANAGER, pdf('Haus_A_2024_Einreichung.pdf'), { folderId: 'folder-plans' }],
    ['the platform’s own guideline', MANAGER, pdf('OIB-Richtlinie_2_2023.pdf'), { folderId: 'folder-plans' }],
    ['a norm while the office keeps no standards of its own', { ...MANAGER, featureFlags: [] } as AuthorizedSession, pdf('DIN_4109-1_2018-01.pdf'), { folderId: 'folder-plans' }],
    ['a norm uploaded into the standards tree itself', MANAGER, pdf('DIN_4109-1_2018-01.pdf'), { folderId: 'topic-fire' }],
    ['a new Fassung of a norm under the standards tree', MANAGER, pdf('DIN_4109-1_2018-01.pdf'), { folderId: 'topic-fire', revisionOf: 'doc-old' }],
  ])('leaves %s where it was uploaded, unrecorded', async (_case, session, file, input) => {
    await uploadToOfficeShelf(session, file, request, input)

    expect(uploadOfficeShelfDocument).toHaveBeenCalledWith(session, file, request, input)
    expect(recordProposal).not.toHaveBeenCalled()
    expect(keepAsOrdinaryFiles).not.toHaveBeenCalled()
  })

  it('keeps a new Fassung of an Ordner file where it was uploaded, and remembers it as an ordinary file before its text is read', async () => {
    await uploadToOfficeShelf(MANAGER, pdf('DIN_4109-1_2018-01.pdf'), request, { folderId: 'folder-plans', revisionOf: 'doc-old' })

    expect(vi.mocked(uploadOfficeShelfDocument).mock.calls[0][3]).toMatchObject({ folderId: 'folder-plans', revisionOf: 'doc-old' })
    expect(recordProposal).not.toHaveBeenCalled()
    expect(keepAsOrdinaryFiles).toHaveBeenCalledWith('org-1', ['doc-new'], 'user-1')
  })
})

describe('an upload on the Normen tab', () => {
  it('is a norm candidate whatever its name: it is recorded, held and waits under the standards root, and “Keine Norm” takes it to the Ordner top level', async () => {
    await uploadToOfficeShelf(MANAGER, pdf('Haus_A_Brandschutzkonzept.pdf'), request, { asNorm: true })

    expect(vi.mocked(uploadOfficeShelfDocument).mock.calls[0][3]).toMatchObject({ folderId: 'folder-root' })
    expect(vi.mocked(uploadOfficeShelfDocument).mock.calls[0][3]).not.toHaveProperty('asNorm')
    expect(recordProposal).toHaveBeenCalledWith(MANAGER, { documentId: 'doc-new' }, 'Haus_A_Brandschutzkonzept.pdf', 'reading', undefined, {
      filedFrom: { folderId: null, upload: true },
    })
  })

  it('stays in the topic it was uploaded into', async () => {
    await uploadToOfficeShelf(MANAGER, pdf('Leitfaden_Fluchtwege.pdf'), request, { folderId: 'topic-fire', asNorm: true })

    expect(vi.mocked(uploadOfficeShelfDocument).mock.calls[0][3]).toMatchObject({ folderId: 'topic-fire' })
    expect(recordProposal).toHaveBeenCalled()
  })

  it('leaves a guideline the platform holds an ordinary file', async () => {
    await uploadToOfficeShelf(MANAGER, pdf('OIB-Richtlinie_2_2023.pdf'), request, { asNorm: true })

    expect(uploadOfficeShelfDocument).toHaveBeenCalledWith(MANAGER, expect.any(File), request, {})
    expect(recordProposal).not.toHaveBeenCalled()
  })
})

describe('proposing an Ordner file as a norm (“Aus Ordnern übernehmen”, base-knowledge-propose)', () => {
  it('takes it the way “Als Norm führen” does: recorded with the folder it came from, held, and moved under the standards root', async () => {
    vi.mocked(readShelfDocument).mockResolvedValue({ id: 'doc-1', fileName: 'Brandschutz_Leitfaden.pdf', folderId: 'folder-plans' } as never)

    expect(await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1', kind: 'guideline' }, 'agent')).toEqual({ id: 'edition_new' })

    expect(recordProposal).toHaveBeenCalledWith(
      MANAGER,
      { documentId: 'doc-1', kind: 'guideline' },
      'Brandschutz_Leitfaden.pdf',
      'agent',
      undefined,
      { filedFrom: { folderId: 'folder-plans' } },
    )
    expect(withholdText).toHaveBeenCalledWith(MANAGER, 'doc-1')
    expect(moveDocumentToFolder).toHaveBeenCalledWith({ documentId: 'doc-1', folderId: 'folder-root', expectedFolderId: 'folder-plans' }, MANAGER)
  })

  it('links a held work as a new edition', async () => {
    vi.mocked(readOfficeEntries).mockResolvedValueOnce([B1600])
    vi.mocked(readShelfDocument).mockResolvedValue({ id: 'doc-1', fileName: 'OENORM_B_1600_2023-02-01.pdf', folderId: null } as never)

    await proposeBaseKnowledge(MANAGER, { documentId: 'doc-1' })

    expect(vi.mocked(recordProposal).mock.calls[0][4]).toBe(B1600)
  })

  it('refuses a document the reader cannot see, and a member', async () => {
    vi.mocked(readShelfDocument).mockResolvedValue(null)
    await expect(proposeBaseKnowledge(MANAGER, { documentId: 'doc-1' })).rejects.toBeInstanceOf(NotFoundError)
    await expect(proposeBaseKnowledge({ ...MANAGER, permissions: [] } as AuthorizedSession, { documentId: 'doc-1' })).rejects.toBeInstanceOf(ForbiddenError)
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
