/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/folder-access', async () => (await import('@/test-utils/folder-access')).openFolderAccessModule())
vi.mock('@/lib/authz/folder-access-repository', () => ({
  listProjectDocumentCollections: vi.fn(async () => []),
  listProjectFolderTree: vi.fn(async () => []),
}))
vi.mock('./collection-placement', () => ({
  placeProjectDocuments: vi.fn(async () => ({ moved: 0, failed: [] })),
}))
vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('@/lib/db/schema/documents', () => ({
  documents: { folderId: 'folder_id', projectId: 'project_id', id: 'id' },
}))
vi.mock('@/lib/db/schema/project-folders', () => ({
  projectFolders: { projectId: 'project_id', parentId: 'parent_id', name: 'name' },
}))
vi.mock('@/lib/db/schema/projects', () => ({
  projects: { id: 'id', organizationId: 'organization_id', deletedAt: 'deleted_at' },
}))

vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn(),
}))

import { getDb } from '@/lib/db'
import { asDb } from '@/test-utils/db-fixtures'
import { validateFolderName, buildFolderPath } from './folders'
import { getOrCreateProjectFolderByName } from './folder-service'

describe('folder service validation', () => {
  it('validates and builds folder paths correctly', () => {
    expect(validateFolderName('Plans').ok).toBe(true)
    expect(validateFolderName('')).toEqual({ ok: false, error: 'Folder name is required.' })
    expect(validateFolderName('..')).toEqual({ ok: false, error: 'Folder name cannot be . or ...' })
    expect(validateFolderName('CON')).toEqual({ ok: false, error: 'Folder name is reserved.' })
  })

  it('builds nested folder paths', () => {
    expect(buildFolderPath('Plans', 'Fire Safety')).toBe('Plans/Fire Safety')
    expect(buildFolderPath('', 'Root')).toBe('Root')
    expect(buildFolderPath(null, 'Root')).toBe('Root')
  })
})

const row = (id: string) => ({
  id,
  projectId: 'proj-1',
  parentId: null,
  name: 'Berichte',
  path: 'Berichte',
  description: null,
  accessMode: 'inherit' as const,
  createdAt: new Date('2026-08-20T00:00:00Z'),
  updatedAt: new Date('2026-08-20T00:00:00Z'),
})

const { accessMode: _accessMode, ...folderOf } = row('folder-new')

describe('getOrCreateProjectFolderByName', () => {
  const select = vi.fn()
  const insert = vi.fn()

  const stubSelect = (...results: Array<Array<ReturnType<typeof row>>>) => {
    for (const result of results) {
      select.mockReturnValueOnce({
        from: () => ({ where: () => ({ limit: () => Promise.resolve(result) }) }),
      })
    }
  }

  const stubInsert = (behaviour: () => Promise<Array<ReturnType<typeof row>>>) => {
    insert.mockReturnValue({ values: () => ({ returning: behaviour }) })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    select.mockReset()
    insert.mockReset()
    vi.mocked(getDb).mockReturnValue(asDb({ select, insert }))
  })

  it('returns the folder that already exists without inserting', async () => {
    stubSelect([row('folder-1')])

    const folder = await getOrCreateProjectFolderByName('proj-1', 'Berichte', 'org-1')

    expect(folder.id).toBe('folder-1')
    expect(insert).not.toHaveBeenCalled()
  })

  it('creates the folder at the project root on first use', async () => {
    stubSelect([])
    stubInsert(async () => [row('folder-new')])

    const folder = await getOrCreateProjectFolderByName('proj-1', 'Berichte', 'org-1')

    expect(folder).toEqual(folderOf)
  })

  it('recovers the concurrent writer’s folder from a unique violation', async () => {
    stubSelect([], [row('folder-winner')])
    stubInsert(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })

    const folder = await getOrCreateProjectFolderByName('proj-1', 'Berichte', 'org-1')

    expect(folder.id).toBe('folder-winner')
  })

  it('re-throws an insert failure that is not a unique violation', async () => {
    stubSelect([])
    stubInsert(async () => {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' })
    })

    await expect(getOrCreateProjectFolderByName('proj-1', 'Berichte', 'org-1')).rejects.toThrow(
      'deadlock detected',
    )
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('re-throws the unique violation when the re-select still finds nothing', async () => {
    stubSelect([], [])
    stubInsert(async () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })

    await expect(getOrCreateProjectFolderByName('proj-1', 'Berichte', 'org-1')).rejects.toThrow(
      'duplicate key',
    )
  })
})
