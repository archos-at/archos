/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db', () => ({
  getDb: vi.fn(),
}))

vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ op: 'eq', col, val }),
  inArray: (col: unknown, values: unknown[]) => ({ op: 'inArray', col, values }),
  and: (...conditions: unknown[]) => ({ op: 'and', conditions }),
  or: (...conditions: unknown[]) => ({ op: 'or', conditions }),
  isNull: (col: unknown) => ({ op: 'isNull', col }),
  desc: (col: unknown) => ({ op: 'desc', col }),
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    op: 'sql',
    strings: Array.from(strings),
    values,
  }),
}))

vi.mock('@/lib/db/schema/project-memory', () => ({
  PROJECT_MEMORY_MAX_RESTRICTED_FOLDERS: 20,
  projectMemory: {
    id: 'pm.id',
    scope: 'pm.scope',
    projectId: 'pm.projectId',
    organizationId: 'pm.organizationId',
    kind: 'pm.kind',
    content: 'pm.content',
    status: 'pm.status',
    confidence: 'pm.confidence',
    verification: 'pm.verification',
    pinned: 'pm.pinned',
    updatedAt: 'pm.updatedAt',
    restrictedFolderIds: 'pm.restrictedFolderIds',
  },
}))

vi.mock('@/lib/db/schema/projects', () => ({
  projects: {
    id: 'p.id',
    organizationId: 'p.organizationId',
    collectionName: 'p.collectionName',
  },
}))

vi.mock('@/lib/authz/folder-access', () => ({
  sourceFoldersOfCollections: vi.fn(async () => new Map<string, string>()),
}))

vi.mock('@/lib/knowledge/embeddings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/knowledge/embeddings')>()
  return { ...actual, embedNote: vi.fn(async () => null), embedNotes: vi.fn(async () => null) }
})

vi.mock('@/lib/upload-screening/service', async () => {
  const { chatScreeningRules, maskText } = await import('@/lib/upload-screening/content-screen')
  const { SUGGESTED_SCREENING_POLICY } = await import('@/lib/upload-screening/policy')
  return {
    maskChatText: vi.fn(async (_organizationId: string, text: string) =>
      maskText(text, chatScreeningRules(SUGGESTED_SCREENING_POLICY))
    ),
  }
})

import { getDb } from '@/lib/db'
import { BadRequestError } from '@/lib/api/errors'
import { sourceFoldersOfCollections } from '@/lib/authz/folder-access'
import { asDb } from '@/test-utils/db-fixtures'
import {
  canonicalRestriction,
  createProjectMemoryItem,
  createProjectMemoryItemForProject,
  memoryVisibleTo,
} from './memory-service'
import { openOnly } from './memory-service.fixtures'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('restricted memory (ADR-0087)', () => {
  const RESTRICTED = 'aaaaaaaa-0000-4000-8000-000000000001'
  const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002'

  const mockFreshWrite = () => {
    const limit = vi.fn().mockResolvedValue([])
    const orderBy = vi.fn().mockReturnValue({ limit })
    const selectWhere = vi.fn().mockReturnValue({ orderBy, limit })
    const from = vi.fn().mockReturnValue({ where: selectWhere })
    const insertReturning = vi.fn().mockResolvedValue([{ id: 'new-1' }])
    const values = vi.fn().mockReturnValue({ returning: insertReturning })
    vi.mocked(getDb).mockReturnValue(
      asDb({ select: vi.fn().mockReturnValue({ from }), insert: vi.fn().mockReturnValue({ values }) })
    )
    return { selectWhere, values }
  }

  it('stores a restriction sorted and de-duplicated; empty is open', () => {
    expect(canonicalRestriction([OTHER, RESTRICTED, ` ${RESTRICTED} `])).toEqual([RESTRICTED, OTHER])
    expect(canonicalRestriction([])).toBeNull()
    expect(canonicalRestriction(null)).toBeNull()
  })

  it('reads open memory only for a reader with no clearance', () => {
    expect(memoryVisibleTo()).toEqual(openOnly)
    expect(memoryVisibleTo([])).toEqual(openOnly)
  })

  it('reads a restricted row only when all of its collections are cleared', () => {
    const condition = memoryVisibleTo([OTHER, RESTRICTED]) as unknown as { strings: string[]; values: unknown[] }
    expect(condition.strings.join('?')).toContain('is null or')
    expect(condition.strings.join('?')).toContain('<@')
    expect(condition.values).toContain(`{"${RESTRICTED}","${OTHER}"}`)
  })

  it('consolidates a restricted write only with rows of exactly the same restriction', async () => {
    const { selectWhere, values } = mockFreshWrite()

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'decision',
      content: 'The fee for stages five to eight is a lump sum',
      restrictedFolderIds: [OTHER, RESTRICTED],
    })

    for (const [condition] of selectWhere.mock.calls) {
      const text = JSON.stringify(condition)
      expect(text).toContain(`{\\"${RESTRICTED}\\",\\"${OTHER}\\"}`)
      expect(text).not.toContain('"op":"isNull","col":"pm.restrictedFolderIds"')
    }
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ restrictedFolderIds: [RESTRICTED, OTHER] })
    )
  })

  it('never retires an open entry for a restricted finding\'s quote', async () => {
    const { selectWhere } = mockFreshWrite()

    await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'decision',
        content: 'The fee is now a lump sum of 190k',
        restrictedFolderIds: [RESTRICTED],
      },
      { supersedesContent: 'The fee is a lump sum of 184k' }
    )

    const resolverCalls = selectWhere.mock.calls.slice(2)
    expect(resolverCalls.length).toBeGreaterThan(0)
    for (const [condition] of resolverCalls) {
      expect(JSON.stringify(condition)).toContain(RESTRICTED)
    }
  })

  it('refuses restricted organization memory', async () => {
    mockFreshWrite()
    await expect(
      createProjectMemoryItem({
        scope: 'organization',
        projectId: null,
        organizationId: 'org-1',
        kind: 'decision',
        content: 'x',
        restrictedFolderIds: [RESTRICTED],
      })
    ).rejects.toBeInstanceOf(BadRequestError)
  })

  describe('createProjectMemoryItemForProject', () => {
    const mockProjectThenWrite = (status: 'active' | 'closed' = 'active') => {
      const projectLimit = vi.fn().mockResolvedValue([{ organizationId: 'org-1', collectionName: 'proj_x', status }])
      const writeLimit = vi.fn().mockResolvedValue([])
      let selects = 0
      const select = vi.fn().mockImplementation(() => {
        selects += 1
        const limit = selects === 1 ? projectLimit : writeLimit
        const orderBy = vi.fn().mockReturnValue({ limit })
        return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ orderBy, limit }) }) }
      })
      const values = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 'new-1' }]) })
      vi.mocked(getDb).mockReturnValue(asDb({ select, insert: vi.fn().mockReturnValue({ values }) }))
      return { values }
    }

    it('rejects a collection that is not a current restricted collection of the project', async () => {
      mockProjectThenWrite()
      vi.mocked(sourceFoldersOfCollections).mockResolvedValueOnce(new Map([['proj_x_rbbbbbbbbbbbb', OTHER]]))

      await expect(
        createProjectMemoryItemForProject('proj-1', {
          kind: 'decision',
          content: 'x',
          restrictedCollections: ['proj_x_raaaaaaaaaaaa'],
        })
      ).rejects.toBeInstanceOf(BadRequestError)
      expect(sourceFoldersOfCollections).toHaveBeenCalledWith('org-1', 'proj-1', 'proj_x', ['proj_x_raaaaaaaaaaaa'])
    })

    it('stores a current restriction', async () => {
      const { values } = mockProjectThenWrite()
      vi.mocked(sourceFoldersOfCollections).mockResolvedValueOnce(new Map([['proj_x_raaaaaaaaaaaa', RESTRICTED]]))

      await createProjectMemoryItemForProject('proj-1', {
        kind: 'decision',
        content: 'x',
        restrictedCollections: ['proj_x_raaaaaaaaaaaa'],
      })

      expect(values).toHaveBeenCalledWith(expect.objectContaining({ restrictedFolderIds: [RESTRICTED] }))
    })

    it('refuses the agent a note in a closed project, before anything is written (ADR-0090)', async () => {
      const { values } = mockProjectThenWrite('closed')
      await expect(createProjectMemoryItemForProject('proj-1', { kind: 'decision', content: 'x' })).rejects.toMatchObject({
        status: 403,
        details: { reason: 'project-closed' },
      })
      expect(values).not.toHaveBeenCalled()
    })

    it('keeps the judge\'s verdict on a restricted note', async () => {
      const { values } = mockProjectThenWrite()
      vi.mocked(sourceFoldersOfCollections).mockResolvedValueOnce(new Map([['proj_x_raaaaaaaaaaaa', RESTRICTED]]))
      await createProjectMemoryItemForProject('proj-1', {
        kind: 'decision',
        content: 'x',
        restrictedCollections: ['proj_x_raaaaaaaaaaaa'],
        restrictionJudge: 'drawn',
      })
      expect(values).toHaveBeenCalledWith(
        expect.objectContaining({ restrictedFolderIds: [RESTRICTED], restrictionJudge: 'drawn' })
      )
    })

    it('never keeps it on an open note', async () => {
      const { values } = mockProjectThenWrite()
      await createProjectMemoryItemForProject('proj-1', { kind: 'decision', content: 'x', restrictionJudge: 'none' })
      expect(values).toHaveBeenCalledWith(expect.objectContaining({ restrictedFolderIds: null, restrictionJudge: null }))
    })

    it('asks nothing about folders for open memory', async () => {
      mockProjectThenWrite()
      vi.mocked(sourceFoldersOfCollections).mockClear()
      await createProjectMemoryItemForProject('proj-1', { kind: 'decision', content: 'x' })
      expect(sourceFoldersOfCollections).not.toHaveBeenCalled()
    })
  })
})
