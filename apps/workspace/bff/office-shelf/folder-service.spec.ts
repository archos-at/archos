/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/documents/shelf-folders', () => ({
  listShelfFolders: vi.fn(),
  ensureShelfFolderPaths: vi.fn(async () => ({ ok: true, folders: [], folderIdByPath: {} })),
}))

import type { AuthorizedSession } from '@/lib/auth/types'
import { ensureShelfFolderPaths, listShelfFolders, type ShelfFolderVisibility } from '@/lib/documents/shelf-folders'
import { ensureOfficeShelfFolderPaths } from './folder-service'

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
