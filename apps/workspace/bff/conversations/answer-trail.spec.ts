/**
 * @vitest-environment node
 *
 * „Gelesen“ under every answer (ADR-0194, what it makes possible 1): each
 * answer's recorded reads, named only where this reader may open them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthorizedSession } from '@/lib/auth/types'

vi.mock('server-only', () => ({}))
const rows = vi.hoisted(() => ({ value: [] as unknown[] }))
vi.mock('@/lib/db', () => ({
  getDb: () => ({ select: () => ({ from: () => ({ where: () => ({ limit: async () => rows.value }) }) }) }),
}))
vi.mock('@/lib/db/tenant-context', () => ({ withTenant: vi.fn((_t: unknown, run: () => unknown) => run()) }))
vi.mock('@/lib/sharing/access', () => ({ requireResourceAccess: vi.fn(async () => undefined) }))
vi.mock('@/lib/authz/projects', () => ({
  requireProjectAccess: vi.fn(async (_s: unknown, projectId: string) => {
    if (projectId !== 'p_open') throw new Error('no')
  }),
}))
vi.mock('@/lib/projects/repository', () => ({ findProjectInOrg: vi.fn(async (id: string) => ({ id, name: 'Wohnbau Graz' })) }))
vi.mock('@/lib/authz/folder-access', () => ({
  customFolderNames: vi.fn(async () => new Map([['f_open', 'Pläne'], ['f_closed', 'Verträge']])),
  isFolderVisibleTo: vi.fn(async (_s: unknown, _p: string, folderId: string) => folderId === 'f_open'),
}))
vi.mock('./restricted-use-repository', () => ({
  projectsOfFolders: vi.fn(async () => new Map([['f_open', 'p_open'], ['f_closed', 'p_open']])),
}))

import { requireResourceAccess } from '@/lib/sharing/access'
import { answerTrails } from './answer-trail'

const session = { organizationId: 'org_1', userId: 'user_ina' } as AuthorizedSession
const row = (extra: Record<string, unknown>) => ({
  messageId: 'm1',
  readProjects: [],
  readFolders: [],
  personalMemory: false,
  readPersonalShelf: false,
  solo: true,
  ...extra,
})

beforeEach(() => {
  vi.clearAllMocks()
  rows.value = []
})

describe('answerTrails', () => {
  it('names what the reader may open and withholds the rest, per answer', async () => {
    rows.value = [
      row({ messageId: 'm1', readProjects: ['p_open', 'p_closed'], readFolders: ['f_open', 'f_closed'] }),
      row({ messageId: 'm2', personalMemory: true, readPersonalShelf: true, solo: true }),
    ]

    const trails = await answerTrails(session, 's_c')

    expect(requireResourceAccess).toHaveBeenCalledWith(session, 'conversation', 's_c', 'viewer')
    expect(trails).toEqual([
      {
        messageId: 'm1',
        places: [
          { kind: 'project', id: 'p_open', name: 'Wohnbau Graz' },
          { kind: 'project', withheld: true },
          { kind: 'folder', id: 'f_open', name: 'Pläne' },
          { kind: 'folder', withheld: true },
        ],
        personalMemory: false,
        personalShelf: false,
        solo: true,
      },
      { messageId: 'm2', places: [], personalMemory: true, personalShelf: true, solo: true },
    ])
  })

  it('asks for the reader’s access to the chat before reading any record', async () => {
    vi.mocked(requireResourceAccess).mockRejectedValueOnce(new Error('not found'))
    await expect(answerTrails(session, 's_c')).rejects.toThrow('not found')
  })
})
