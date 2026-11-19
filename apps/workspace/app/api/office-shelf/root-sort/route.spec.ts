/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const session = {
  userId: 'user-1',
  organizationId: 'org-1',
  email: 'test@grid.com',
  role: 'admin',
  permissions: [] as string[],
  featureFlags: ['office-standards'] as string[] | null,
}

vi.mock('@/lib/auth/require-auth', () => ({ requireAuthorizedSession: vi.fn(async () => session) }))
vi.mock('@/lib/documents/shelf-authz', () => ({ requireShelfWrite: vi.fn(), requireShelfRead: vi.fn() }))
vi.mock('@/lib/documents/shelf-folders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/documents/shelf-folders')>()),
  listShelfFolders: vi.fn(),
}))
vi.mock('@/lib/filing/repository', () => ({ listRootDocuments: vi.fn(async () => []) }))
vi.mock('@/lib/filing/root-sort-run-repository', () => ({
  failStalledRootSortRuns: vi.fn(async () => []),
  findLatestRootSortRun: vi.fn(async () => null),
}))

import { listShelfFolders, type FolderRow } from '@/lib/documents/shelf-folders'
import { GET } from './route'

const folder = (id: string, path: string): FolderRow => ({
  id,
  projectId: null,
  parentId: null,
  name: path.split('/').at(-1) ?? path,
  path,
  description: null,
  createdAt: new Date('2026-10-01T00:00:00Z'),
  updatedAt: new Date('2026-10-01T00:00:00Z'),
})

const describeSort = async () =>
  (await GET(new NextRequest('https://grid.test/api/office-shelf/root-sort'), { params: Promise.resolve({}) })).json()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('REQUIRE_AUTH', 'true')
  vi.mocked(listShelfFolders).mockResolvedValue([
    folder('folder-plans', 'Pläne'),
    folder('folder-standards', 'Grundlagen des Büros'),
    folder('folder-fire', 'Grundlagen des Büros/Brandschutz'),
  ])
})

afterEach(() => vi.unstubAllEnvs())

describe('GET /api/office-shelf/root-sort', () => {
  it('counts only the Ordner’s folders as places to sort into once the office keeps its own standards', async () => {
    session.featureFlags = ['office-standards']

    expect(await describeSort()).toMatchObject({ folders: 1 })
  })

  it('counts every folder while the office has no standards of its own', async () => {
    session.featureFlags = []

    expect(await describeSort()).toMatchObject({ folders: 3 })
  })
})
