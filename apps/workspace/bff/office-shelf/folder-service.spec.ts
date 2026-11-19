/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/shelf-folders', () => ({
  listShelfFolders: vi.fn(),
  ensureShelfFolderPaths: vi.fn(async () => ({ ok: true, folders: [], folderIdByPath: {} })),
  findShelfFolder: vi.fn(async () => undefined),
  updateShelfFolder: vi.fn(async () => ({ ok: true, folder: { id: 'folder-plans' } })),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { ensureShelfFolderPaths, listShelfFolders, updateShelfFolder, type ShelfFolderVisibility } from '@/lib/documents/shelf-folders'
import { ensureOfficeShelfFolderPaths, updateOfficeShelfFolder } from './folder-service'
import { ORDNER_FOLDER_STAYS_OUT } from './standards-folder'

const session = { userId: 'user-1', organizationId: 'org-1', featureFlags: ['office-standards'] } as AuthorizedSession
const input = { parentId: null, paths: ['Grundlagen des Büros/Brandschutz'] }

const visibilityPassed = (): ShelfFolderVisibility | undefined => vi.mocked(ensureShelfFolderPaths).mock.lastCall?.[3]

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  vi.mocked(listShelfFolders).mockResolvedValue([
    { id: 'folder-plans', path: 'Pläne' },
    { id: 'folder-standards', path: 'Grundlagen des Büros' },
    { id: 'folder-fire', path: 'Grundlagen des Büros/Brandschutz' },
  ] as never)
})

afterEach(() => vi.unstubAllEnvs())

describe('ensureOfficeShelfFolderPaths, behind a folder dropped into the Ordner', () => {
  it('never walks into the standards tree once the office keeps its own standards', async () => {
    await ensureOfficeShelfFolderPaths(session, input)

    const visibility = visibilityPassed()
    expect(visibility?.isVisible('folder-plans')).toBe(true)
    expect(visibility?.isVisible('folder-standards')).toBe(false)
    expect(visibility?.isVisible('folder-fire')).toBe(false)
    expect(await visibility?.recheckVisible('folder-fire')).toBe(false)
  })

  it('walks every folder while the office has no standards of its own', async () => {
    await ensureOfficeShelfFolderPaths({ ...session, featureFlags: [] }, input)

    expect(visibilityPassed()).toBeUndefined()
    expect(listShelfFolders).not.toHaveBeenCalled()
  })
})

describe('updateOfficeShelfFolder, moving a folder', () => {
  it('keeps an Ordner folder out of the standards tree once the office keeps its own standards', async () => {
    expect(await updateOfficeShelfFolder(session, { folderId: 'folder-plans', parentId: 'folder-fire' })).toEqual({
      ok: false,
      error: ORDNER_FOLDER_STAYS_OUT,
    })
    expect(await updateOfficeShelfFolder(session, { folderId: 'folder-plans', parentId: 'folder-standards' })).toMatchObject({ ok: false })
    expect(updateShelfFolder).not.toHaveBeenCalled()
  })

  it('moves a topic within the standards tree, an Ordner folder within the Ordner, and anything while the office has no standards of its own', async () => {
    await updateOfficeShelfFolder(session, { folderId: 'folder-fire', parentId: 'folder-standards' })
    await updateOfficeShelfFolder(session, { folderId: 'folder-plans', parentId: null })
    await updateOfficeShelfFolder({ ...session, featureFlags: [] }, { folderId: 'folder-plans', parentId: 'folder-fire' })
    expect(updateShelfFolder).toHaveBeenCalledTimes(3)
  })
})
