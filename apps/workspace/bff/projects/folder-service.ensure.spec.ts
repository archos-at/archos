/**
 * @vitest-environment node
 *
 * `ensureProjectFolderPaths` — the one write a folder upload makes before any
 * bytes move.
 *
 * What it has to get right is MATCHING. A tree dragged off an office server
 * overlaps the project most of the time, and a resolver that only matched
 * exactly would create a second „Pläne" beside the one already there and file
 * half the Einreichung into it — invisibly, because the two render identically.
 * macOS is what makes that concrete: it hands over decomposed umlauts, so the
 * folder from the desktop and the folder typed into Piloti are different
 * strings for the same name.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/authz/folder-access', async () => ({
  ...(await import('@/test-utils/folder-access')).openFolderAccessModule(),
  getProjectFolderAccess: vi.fn(async () => ({
    hiddenFolderIds: new Set<string>(),
    isVisible: () => true,
    collectionFor: () => 'proj_collection',
    clearedRestrictedCollections: [],
    levelOf: () => 'write',
    sourceFolderOf: () => null,
    anyRestricted: false,
  })),
}))
vi.mock('@/lib/authz/folder-access-repository', () => ({
  listProjectDocumentCollections: vi.fn(async () => []),
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
  projectFolders: { id: 'id', projectId: 'project_id', parentId: 'parent_id', name: 'name' },
}))
vi.mock('@/lib/db/schema/projects', () => ({
  projects: { id: 'id', organizationId: 'organization_id', deletedAt: 'deleted_at' },
}))

vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn(),
}))

import { getDb } from '@/lib/db'
import { requireProjectAccess } from '@/lib/authz/projects'
import { ForbiddenError } from '@/lib/api/errors'
import { getProjectFolderAccess, type FolderLevel, type ProjectFolderAccess } from '@/lib/authz/folder-access'
import { asDb } from '@/test-utils/db-fixtures'
import { ensureProjectFolderPaths } from './folder-service'
import type { AuthorizedSession } from '@/lib/auth/types'

const session = { userId: 'user-1', organizationId: 'org-1' } as AuthorizedSession

const TENANT = { organizationId: 'org-1', scope: 'project' }

interface Row {
  id: string
  projectId: string
  parentId: string | null
  name: string
  path: string
  createdAt: Date
  updatedAt: Date
}

const at = new Date('2026-09-01T00:00:00Z')
const row = (id: string, name: string, path: string, parentId: string | null = null): Row => ({
  id,
  projectId: 'proj-1',
  parentId,
  name,
  path,
  createdAt: at,
  updatedAt: at,
})

function fakeDb(existing: Row[], onInsert?: () => never) {
  const rows = [...existing]
  let minted = 0
  const inserted: Array<{ name: string; parentId: string | null; path: string }> = []

  const select = vi.fn(() => ({
    from: () => {
      const where = (): Promise<Row[]> & { limit: () => Promise<Row[]> } => {
        const promise = Promise.resolve(rows) as Promise<Row[]> & { limit: () => Promise<Row[]> }
        promise.limit = () => Promise.resolve(rows.slice(0, 1))
        return promise
      }
      return { where }
    },
  }))

  const insert = vi.fn(() => ({
    values: (values: { name: string; parentId: string | null; path: string }) => ({
      returning: async () => {
        if (onInsert) onInsert()
        minted += 1
        const created = row(`new-${minted}`, values.name, values.path, values.parentId)
        rows.push(created)
        inserted.push(values)
        return [created]
      },
    }),
  }))

  return { db: asDb({ select, insert }), inserted, insert }
}

describe('ensureProjectFolderPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin' } as never)
  })

  it('reuses a folder whose name differs only in case or Unicode form', async () => {
    const existing = [row('f1', 'PLÄNE', 'PLÄNE')]
    const fake = fakeDb(existing)
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['Pläne'.normalize('NFD')] },
      session,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('unreachable')
    expect(result.folderIdByPath).toEqual({ ['Pläne'.normalize('NFD')]: 'f1' })
    expect(fake.insert).not.toHaveBeenCalled()
    expect(result.folders).toEqual([])
  })

  it('creates a nested path top-down, each level under the one above it', async () => {
    const fake = fakeDb([])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['Wohnbau/03_Einreichung'] },
      session,
    )

    expect(result.ok).toBe(true)
    expect(fake.inserted).toEqual([
      { ...TENANT, projectId: 'proj-1', parentId: null, name: 'Wohnbau', path: 'Wohnbau' },
      {
        ...TENANT,
        projectId: 'proj-1',
        parentId: 'new-1',
        name: '03_Einreichung',
        path: 'Wohnbau/03_Einreichung',
      },
    ])
  })

  it('creates a shared ancestor once across several paths', async () => {
    const fake = fakeDb([])
    vi.mocked(getDb).mockReturnValue(fake.db)

    await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['W/Plaene', 'W/Statik'] },
      session,
    )

    expect(fake.inserted.map((values) => values.path)).toEqual(['W', 'W/Plaene', 'W/Statik'])
  })

  it('refuses a path deeper than the dropped-tree walk will ever produce', async () => {
    const fake = fakeDb([])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: [Array.from({ length: 13 }, (_, i) => `d${i}`).join('/')] },
      session,
    )

    expect(result).toEqual({ ok: false, error: 'A folder path may be at most 12 levels deep.' })
  })

  it('refuses more paths than a folder upload can honestly need', async () => {
    const fake = fakeDb([])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: Array.from({ length: 301 }, (_, i) => `d${i}`) },
      session,
    )

    expect(result.ok).toBe(false)
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('files into the concurrent writer’s folder when the insert loses the race', async () => {
    const winner = row('f-winner', 'Wohnbau', 'Wohnbau')
    const fake = fakeDb([winner], () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['Statik'] },
      session,
    )

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) throw new Error('unreachable')
    expect(result.folderIdByPath).toEqual({ Statik: 'f-winner' })
  })

  it('re-throws an insert failure that is not a race', async () => {
    const fake = fakeDb([], () => {
      throw Object.assign(new Error('deadlock detected'), { code: '40P01' })
    })
    vi.mocked(getDb).mockReturnValue(fake.db)

    await expect(
      ensureProjectFolderPaths({ projectId: 'proj-1', parentId: null, paths: ['W'] }, session),
    ).rejects.toThrow('deadlock detected')
  })
})

describe('ensureProjectFolderPaths and folders the reader may not see (ADR-0087)', () => {
  const HIDDEN = 'f-honorare'
  const hiding = (...ids: string[]): ProjectFolderAccess => ({
    hiddenFolderIds: new Set(ids),
    isVisible: (id: string | null) => id === null || !ids.includes(id),
    collectionFor: () => 'proj_collection',
    clearedRestrictedCollections: [],
    levelOf: (id: string | null): FolderLevel => (id !== null && ids.includes(id) ? 'none' : 'write'),
    sourceFolderOf: () => null,
    anyRestricted: true,
  })

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-admin' } as never)
    vi.mocked(getProjectFolderAccess).mockResolvedValue(hiding(HIDDEN))
  })

  it('answers a hidden parent like a missing one', async () => {
    const fake = fakeDb([row(HIDDEN, 'Honorare', 'Honorare')])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: HIDDEN, paths: ['Neu'] },
      session,
    )

    expect(result).toEqual({ ok: false, error: 'Parent folder not found.' })
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('never matches a hidden folder by a looser spelling, nor creates below it', async () => {
    const fake = fakeDb([row(HIDDEN, 'Honorare', 'Honorare')])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['honorare', 'honorare/Neu'] },
      session,
    )

    if (!result.ok) throw new Error(result.error)
    expect(Object.values(result.folderIdByPath)).not.toContain(HIDDEN)
    expect(fake.inserted.map((entry) => entry.path)).toEqual(['honorare', 'honorare/Neu'])
    expect(fake.inserted.every((entry) => entry.parentId !== HIDDEN)).toBe(true)
    expect(JSON.stringify(result)).not.toContain('Honorare')
  })

  it('refuses the exact name a hidden sibling holds, without naming it', async () => {
    const fake = fakeDb([row(HIDDEN, 'Honorare', 'Honorare')])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['Honorare/Neu'] },
      session,
    )

    expect(result).toEqual({ ok: false, error: 'A folder with this name already exists here.' })
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('does not file into a concurrent writer\u2019s folder the reader may not see', async () => {
    const winner = row(HIDDEN, 'Statik', 'Statik')
    const fake = fakeDb([], () => {
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    vi.mocked(getDb).mockReturnValue(fake.db)
    vi.mocked(fake.db.select).mockImplementation(
      () =>
        ({
          from: () => ({
            where: () => Object.assign(Promise.resolve([]), { limit: async () => [winner] }),
          }),
        }) as never,
    )

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['Statik'] },
      session,
    )

    expect(result).toEqual({ ok: false, error: 'A folder with this name already exists here.' })
  })
})

describe('ensureProjectFolderPaths and folders the reader may only read (ADR-0088)', () => {
  const READ_ONLY = 'f-plaene'

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(requireProjectAccess).mockResolvedValue({ role: 'project-editor' } as never)
    vi.mocked(getProjectFolderAccess).mockResolvedValue({
      hiddenFolderIds: new Set(),
      isVisible: () => true,
      collectionFor: () => 'proj_collection',
      clearedRestrictedCollections: [],
      levelOf: (id: string | null): FolderLevel => (id === READ_ONLY ? 'read' : 'write'),
      sourceFolderOf: () => null,
      anyRestricted: true,
    })
  })

  it('matches a read-only folder (the upload into it asks on its own) but creates nothing below it', async () => {
    const fake = fakeDb([row(READ_ONLY, 'Pläne', 'Pläne')])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const matched = await ensureProjectFolderPaths({ projectId: 'proj-1', parentId: null, paths: ['Pläne'] }, session)
    if (!matched.ok) throw new Error(matched.error)
    expect(matched.folderIdByPath['Pläne']).toBe(READ_ONLY)

    await expect(
      ensureProjectFolderPaths({ projectId: 'proj-1', parentId: null, paths: ['Pläne/Neu'] }, session)
    ).rejects.toBeInstanceOf(ForbiddenError)
    expect(fake.insert).not.toHaveBeenCalled()
  })

  it('creates a nested new path under a writable folder, though the access read before knows none of the new folders', async () => {
    vi.mocked(getProjectFolderAccess).mockResolvedValue({
      hiddenFolderIds: new Set(),
      isVisible: () => true,
      collectionFor: () => 'proj_collection',
      clearedRestrictedCollections: [],
      levelOf: (id: string | null): FolderLevel => (id === null || id === 'f-statik' ? 'write' : 'none'),
      sourceFolderOf: () => null,
      anyRestricted: true,
    })
    const fake = fakeDb([row('f-statik', 'Statik', 'Statik')])
    vi.mocked(getDb).mockReturnValue(fake.db)

    const result = await ensureProjectFolderPaths(
      { projectId: 'proj-1', parentId: null, paths: ['Statik/Einreichung/Pläne', 'Statik/Einreichung/Berichte'] },
      session
    )

    if (!result.ok) throw new Error(result.error)
    expect(fake.inserted.map((folder) => folder.path)).toEqual([
      'Statik/Einreichung',
      'Statik/Einreichung/Pläne',
      'Statik/Einreichung/Berichte',
    ])
  })
})
