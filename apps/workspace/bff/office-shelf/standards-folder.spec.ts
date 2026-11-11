/**
 * The base-knowledge root keeps its name and place (`standards-folder.ts`): the
 * office shelf's folder service refuses its rename, move and delete, and passes
 * a description change and every other folder through.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/shelf-folders', () => ({
  createShelfFolder: vi.fn(),
  deleteShelfFolder: vi.fn(async () => ({ ok: true, result: { documentsMoved: 0, foldersMoved: 0 } })),
  ensureShelfFolderPaths: vi.fn(),
  findShelfFolder: vi.fn(),
  listShelfFolders: vi.fn(),
  updateShelfFolder: vi.fn(async () => ({ ok: true })),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { deleteShelfFolder, findShelfFolder, updateShelfFolder } from '@/lib/documents/shelf-folders'
import { deleteOfficeShelfFolder, updateOfficeShelfFolder } from './folder-service'
import { STANDARDS_FOLDER_NAME, STANDARDS_ROOT_FIXED, isUnderStandardsRoot } from './standards-folder'

const SESSION = { organizationId: 'org-1' } as AuthorizedSession
type Row = NonNullable<Awaited<ReturnType<typeof findShelfFolder>>>
const ROOT = { id: 'root', parentId: null, name: STANDARDS_FOLDER_NAME } as Row
const CHILD = { id: 'fire', parentId: 'root', name: 'Brandschutz' } as Row

beforeEach(() => vi.clearAllMocks())

describe('the base-knowledge root', () => {
  it('is not renamed, moved or deleted', async () => {
    vi.mocked(findShelfFolder).mockResolvedValue(ROOT)
    expect(await updateOfficeShelfFolder(SESSION, { folderId: 'root', name: 'Normen' })).toEqual({ ok: false, error: STANDARDS_ROOT_FIXED })
    expect(await updateOfficeShelfFolder(SESSION, { folderId: 'root', parentId: 'x' })).toEqual({ ok: false, error: STANDARDS_ROOT_FIXED })
    expect(await deleteOfficeShelfFolder(SESSION, 'root')).toEqual({ ok: false, error: STANDARDS_ROOT_FIXED })
    expect(updateShelfFolder).not.toHaveBeenCalled()
    expect(deleteShelfFolder).not.toHaveBeenCalled()
  })

  it('takes a description, and its subfolders change freely', async () => {
    vi.mocked(findShelfFolder).mockResolvedValue(ROOT)
    await updateOfficeShelfFolder(SESSION, { folderId: 'root', description: 'Gekaufte Normen' })
    vi.mocked(findShelfFolder).mockResolvedValue(CHILD)
    await updateOfficeShelfFolder(SESSION, { folderId: 'fire', name: 'Brandschutz alt' })
    await deleteOfficeShelfFolder(SESSION, 'fire')
    expect(updateShelfFolder).toHaveBeenCalledTimes(2)
    expect(deleteShelfFolder).toHaveBeenCalledTimes(1)
  })

  it('holds the paths below it, and no sibling whose name only starts the same', () => {
    expect(isUnderStandardsRoot(`${STANDARDS_FOLDER_NAME}/Brandschutz`)).toBe(true)
    expect(isUnderStandardsRoot(`${STANDARDS_FOLDER_NAME} alt`)).toBe(false)
  })
})
