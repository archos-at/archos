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
import { makeMemoryItem } from '@/test-utils/db-fixtures'
import { createProjectMemoryItem } from './memory-service'
import { and, eq, openOnly, supersedable } from './memory-service.fixtures'
import { mockNearDupChain, mockSupersedeChain } from './memory-service-db.fixtures'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('createProjectMemoryItem paraphrase de-duplication', () => {
  it('retires the entry a caller quotes as superseded', async () => {
    const stale = makeMemoryItem({
      id: 'stale-3',
      kind: 'constraint',
      content: 'The stairwell must be pressurised (Druckbelueftung)',
    })
    const { values, txSet, txWhere } = mockSupersedeChain([[], [], [stale]])

    await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'Natural smoke extraction was approved for the stairwell instead.',
      },
      { supersedesContent: 'The stairwell must be pressurised (Druckbelueftung)' }
    )

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ supersedesId: 'stale-3' }))
    expect(txSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }))
    expect(txWhere).toHaveBeenCalledWith(and(eq('pm.id', 'stale-3'), supersedable))
  })

  it('retires a named target even when the finding merges into a paraphrase', async () => {
    const existing = makeMemoryItem({
      id: 'dup-1',
      kind: 'derived_fact',
      content: 'Natural smoke extraction was approved for the stairwell',
    })
    const stale = makeMemoryItem({
      id: 'stale-3',
      kind: 'constraint',
      content: 'The stairwell must be pressurised (Druckbelueftung)',
    })
    const { values, set } = mockSupersedeChain([[], [existing], [stale]])
    const onSuperseded = vi.fn()

    await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'Natural smoke extraction was approved for the stairwell instead',
      },
      { supersedesContent: 'The stairwell must be pressurised (Druckbelueftung)', onSuperseded }
    )

    expect(values).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }))
    expect(onSuperseded).toHaveBeenCalledWith('stale-3')
  })

  it('records a conflict instead of retiring a pinned, human-curated note', async () => {
    const human = makeMemoryItem({
      id: 'human-1',
      kind: 'constraint',
      pinned: true,
      content: 'The stairwell must be pressurised (Druckbelueftung)',
    })
    const { values, txSet } = mockSupersedeChain([[], [], [human]])

    await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'Natural smoke extraction was approved for the stairwell instead.',
      },
      { supersedesContent: 'The stairwell must be pressurised (Druckbelueftung)' }
    )

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ conflictsWithId: 'human-1' }))
    expect(values).not.toHaveBeenCalledWith(expect.objectContaining({ supersedesId: 'human-1' }))
    expect(txSet).not.toHaveBeenCalled()
  })

  it('reports the retired id to the caller only when it actually retired a row', async () => {
    const stale = makeMemoryItem({ id: 'stale-4', content: 'The stairwell must be pressurised' })
    mockSupersedeChain([[], [], [stale]])
    const onSuperseded = vi.fn()

    await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'Natural smoke extraction was approved for the stairwell instead.',
      },
      { supersedesContent: 'The stairwell must be pressurised', onSuperseded }
    )

    expect(onSuperseded).toHaveBeenCalledWith('stale-4')

    const raced = vi.fn()
    mockSupersedeChain([[], [], [stale]]).txReturning.mockResolvedValue([])
    await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'Natural smoke extraction was approved for the stairwell instead.',
      },
      { supersedesContent: 'The stairwell must be pressurised', onSuperseded: raced }
    )

    expect(raced).not.toHaveBeenCalled()
  })

  it('ignores a quote that matches no active entry, and still records the finding', async () => {
    const unrelated = makeMemoryItem({
      id: 'other-1',
      content: 'The site is in Vienna district 17',
    })
    const { values, transaction } = mockSupersedeChain([[], [], [unrelated]])

    const result = await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'The garage is naturally ventilated.',
      },
      { supersedesContent: 'A note that was never written to this project at all' }
    )

    expect(result).toEqual({ id: 'new-1' })
    expect(values).toHaveBeenCalledWith(
      expect.not.objectContaining({ supersedesId: expect.anything() })
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it.each([
    ['pinned', makeMemoryItem({ id: 'human-1', pinned: true })],
    ['user-confirmed', makeMemoryItem({ id: 'human-2', verification: 'user_confirmed' })],
    ['user-authored', makeMemoryItem({ id: 'human-3', provenanceType: 'user' })],
  ])('records the correction but will not retire a %s entry', async (_label, curated) => {
    const { values, transaction } = mockSupersedeChain([[], [], [curated]])

    const result = await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'A newer conclusion that overturns the curated note.',
      },
      { supersedesContent: curated.content }
    )

    expect(result).toEqual({ id: 'new-1' })
    expect(values).toHaveBeenCalledWith(
      expect.not.objectContaining({ supersedesId: expect.anything() })
    )
    expect(transaction).not.toHaveBeenCalled()
  })

  it('restricts the near-dup scan to active items of the same kind', async () => {
    const { selectWhere } = mockNearDupChain([])

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'decision',
      content: 'The client decided on a steel frame construction for the hall',
    })

    expect(selectWhere).toHaveBeenNthCalledWith(
      2,
      and(
        and(and(eq('pm.scope', 'project'), eq('pm.projectId', 'proj-1')), openOnly),
        eq('pm.status', 'active'),
        eq('pm.kind', 'decision')
      )
    )
  })
})
