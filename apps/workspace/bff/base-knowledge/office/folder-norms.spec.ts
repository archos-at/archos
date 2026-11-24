import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('./folder-norms-repository', () => ({ listUndecidedFolderFiles: vi.fn(), keepAsOrdinaryFiles: vi.fn() }))
vi.mock('./norm-intake', () => ({ takeAsNorm: vi.fn() }))
vi.mock('../store/repository', () => ({ readOfficeEntries: vi.fn(async () => []) }))
vi.mock('./folders', () => ({ standardsRoot: vi.fn(async () => ({ id: 'folder-standards' })) }))
vi.mock('@/lib/upload-screening/quarantine-reviewers', () => ({ shelfReaderFor: vi.fn(async () => ({ kind: 'reviewer' })) }))

import { ConflictError, ForbiddenError, NotFoundError, UnprocessableError } from '@/lib/api/errors'
import type { AuthorizedSession } from '@/lib/auth/types'
import { ORG_PERMISSIONS } from '@/lib/authz/permissions'
import { keepAsOrdinaryFiles, listUndecidedFolderFiles, type FolderFile } from './folder-norms-repository'
import { decideFolderNorms, listFolderNorms } from './folder-norms'
import { takeAsNorm } from './norm-intake'

const MANAGER = {
  userId: 'user-1',
  organizationId: 'org-1',
  permissions: [ORG_PERMISSIONS.officeShelfManage],
  featureFlags: ['office-standards'],
} as unknown as AuthorizedSession

const FOLDER = 'folder-normen'
const at = (id: string, fileName: string): FolderFile => ({ id, fileName, folderId: FOLDER })
const FILES = [
  at('doc-1', 'OENORM_B_1600_2017-04-15.pdf'),
  at('doc-2', 'Grundriss_EG.pdf'),
  at('doc-3', 'DIN_4109-1_2018-01.pdf'),
  at('doc-4', 'OIB-Richtlinie_2_2023.pdf'),
]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  vi.mocked(listUndecidedFolderFiles).mockResolvedValue(FILES)
})

afterEach(() => vi.unstubAllEnvs())

describe('listFolderNorms', () => {
  it('answers the files of the folder that read as norms, leaving out the platform’s own guideline', async () => {
    const found = await listFolderNorms(MANAGER, FOLDER)
    expect(listUndecidedFolderFiles).toHaveBeenCalledWith('org-1', { kind: 'reviewer' }, { folderId: FOLDER, limit: 500 })
    expect(found).toEqual({
      folderId: FOLDER,
      total: 2,
      norms: [
        { documentId: 'doc-1', fileName: 'OENORM_B_1600_2017-04-15.pdf', designation: 'ÖNORM B 1600' },
        { documentId: 'doc-3', fileName: 'DIN_4109-1_2018-01.pdf', designation: 'DIN 4109-1' },
      ],
      nextCursor: null,
    })
  })

  it('pages', async () => {
    const page = await listFolderNorms(MANAGER, FOLDER, { limit: 1 })
    expect(page).toMatchObject({ total: 2, nextCursor: '1' })
    expect(page.norms.map((norm) => norm.documentId)).toEqual(['doc-1'])
    expect((await listFolderNorms(MANAGER, FOLDER, { limit: 1, cursor: '1' })).norms.map((norm) => norm.documentId)).toEqual(['doc-3'])
  })

  it('is hidden from a member who may not manage the office shelf, and from an office without office-standards', async () => {
    await expect(listFolderNorms({ ...MANAGER, permissions: [] }, FOLDER)).rejects.toBeInstanceOf(ForbiddenError)
    await expect(listFolderNorms({ ...MANAGER, featureFlags: [] }, FOLDER)).rejects.toBeInstanceOf(NotFoundError)
    expect(listUndecidedFolderFiles).not.toHaveBeenCalled()
  })
})

describe('decideFolderNorms', () => {
  it('takes each norm out of the folder under the standards root, remembering the folder, and scans again', async () => {
    const decision = await decideFolderNorms(MANAGER, FOLDER, { action: 'record' })
    expect(takeAsNorm).toHaveBeenCalledTimes(2)
    const place = { rootId: 'folder-standards', entries: [], standards: new Set(['folder-standards']) }
    expect(takeAsNorm).toHaveBeenCalledWith(
      MANAGER,
      { documentId: 'doc-1', fileName: 'OENORM_B_1600_2017-04-15.pdf', designation: 'ÖNORM B 1600', folderId: FOLDER },
      place,
    )
    expect(takeAsNorm).toHaveBeenCalledWith(MANAGER, expect.objectContaining({ documentId: 'doc-3', folderId: FOLDER }), place)
    expect(decision).toMatchObject({ action: 'record', failed: [], remaining: 0 })
    expect(decision.done.map((norm) => norm.documentId)).toEqual(['doc-1', 'doc-3'])
    expect(keepAsOrdinaryFiles).not.toHaveBeenCalled()
  })

  it('names a refused file and goes on with the others', async () => {
    vi.mocked(takeAsNorm)
      .mockRejectedValueOnce(new ConflictError('This document is already recorded as base knowledge.'))
      .mockRejectedValueOnce(new UnprocessableError('The document was moved since; it was left where it is.'))
    const decision = await decideFolderNorms(MANAGER, FOLDER, { action: 'record' })
    expect(decision.done).toEqual([])
    expect(decision.failed).toEqual([
      expect.objectContaining({ documentId: 'doc-1', error: 'This document is already recorded as base knowledge.' }),
      expect.objectContaining({ documentId: 'doc-3', error: 'The document was moved since; it was left where it is.' }),
    ])
  })

  it('records at most 50 in one request and says how many remain', async () => {
    vi.mocked(listUndecidedFolderFiles).mockResolvedValue(
      Array.from({ length: 53 }, (_, index) => at(`doc-${index}`, `OENORM_B_${1000 + index}.pdf`)),
    )
    const decision = await decideFolderNorms(MANAGER, FOLDER, { action: 'record' })
    expect(takeAsNorm).toHaveBeenCalledTimes(50)
    expect(decision.remaining).toBe(3)
  })

  it('keeps the folder’s norms as ordinary files without proposing them, and scans again', async () => {
    const decision = await decideFolderNorms(MANAGER, FOLDER, { action: 'keep' })
    expect(keepAsOrdinaryFiles).toHaveBeenCalledWith('org-1', ['doc-1', 'doc-3'], 'user-1')
    expect(takeAsNorm).not.toHaveBeenCalled()
    expect(decision).toMatchObject({ action: 'keep', remaining: 0 })
  })

  it('does nothing in a folder without norms', async () => {
    vi.mocked(listUndecidedFolderFiles).mockResolvedValue([at('doc-2', 'Grundriss_EG.pdf')])
    expect(await decideFolderNorms(MANAGER, FOLDER, { action: 'keep' })).toEqual({ action: 'keep', done: [], failed: [], remaining: 0 })
    expect(keepAsOrdinaryFiles).not.toHaveBeenCalled()
  })

  it('refuses a member who may not manage the office shelf', async () => {
    await expect(decideFolderNorms({ ...MANAGER, permissions: [] }, FOLDER, { action: 'keep' })).rejects.toBeInstanceOf(ForbiddenError)
    expect(keepAsOrdinaryFiles).not.toHaveBeenCalled()
  })
})
