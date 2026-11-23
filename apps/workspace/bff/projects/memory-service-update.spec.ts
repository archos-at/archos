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
import { ConflictError } from '@/lib/api/errors'
import { embedNote } from '@/lib/knowledge/embeddings'
import { asDb, makeMemoryItem } from '@/test-utils/db-fixtures'
import { memoryVisibleTo, updateProjectMemoryItem } from './memory-service'
import { and, eq, inArray, openOnly } from './memory-service.fixtures'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('updateProjectMemoryItem tenancy guard', () => {
  const mockUpdateChain = (rows: unknown[]) => {
    const returning = vi.fn().mockResolvedValue(rows)
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    vi.mocked(getDb).mockReturnValue(asDb({ update: vi.fn().mockReturnValue({ set }) }))
    return { where }
  }

  it('scopes org-owner updates to organization items of that org only', async () => {
    const { where } = mockUpdateChain([])

    const result = await updateProjectMemoryItem({ organizationId: 'org-1' }, 'item-1', {
      pinned: true,
    })

    expect(result).toBeNull()
    expect(where).toHaveBeenCalledWith(
      and(
        eq('pm.id', 'item-1'),
        and(eq('pm.scope', 'organization'), eq('pm.organizationId', 'org-1'), openOnly),
        undefined
      )
    )
  })

  it('scopes project-owner updates to that project, and to the items the owner may see', async () => {
    const { where } = mockUpdateChain([{ id: 'item-1' }])

    const result = await updateProjectMemoryItem(
      { projectId: 'proj-1', organizationId: 'org-1', readableFolderIds: [] },
      'item-1',
      { status: 'dismissed' }
    )

    expect(result).toEqual({ id: 'item-1' })
    expect(where).toHaveBeenCalledWith(
      and(eq('pm.id', 'item-1'), and(eq('pm.projectId', 'proj-1'), openOnly), inArray('pm.status', ['dismissed', 'active']))
    )
  })

  it('reaches a restricted item only for an owner cleared for it (ADR-0087)', async () => {
    const { where } = mockUpdateChain([{ id: 'item-1' }])

    await updateProjectMemoryItem(
      { projectId: 'proj-1', organizationId: 'org-1', readableFolderIds: ['proj_x_rbbbbbbbbbbbb', 'proj_x_raaaaaaaaaaaa'] },
      'item-1',
      { pinned: true }
    )

    expect(where).toHaveBeenCalledWith(
      and(
        eq('pm.id', 'item-1'),
        and(eq('pm.projectId', 'proj-1'), memoryVisibleTo(['proj_x_raaaaaaaaaaaa', 'proj_x_rbbbbbbbbbbbb'])),
        undefined
      )
    )
  })
})

describe('a note moves only as its lifecycle allows (ADR-0179)', () => {
  const owner = { projectId: 'proj-1', organizationId: 'org-1', readableFolderIds: [] }
  const mockRefusedMove = (held: string | null) => {
    const updateWhere = vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) })
    const limit = vi.fn().mockResolvedValue(held ? [{ status: held }] : [])
    const selectWhere = vi.fn().mockReturnValue({ limit })
    vi.mocked(getDb).mockReturnValue(
      asDb({
        update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: updateWhere }) }),
        select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ where: selectWhere }) }),
      })
    )
    return { updateWhere }
  }

  it.each([
    ['restore a dismissed or superseded note', 'active', ['active', 'superseded', 'dismissed']],
    ['dismiss an active note', 'dismissed', ['dismissed', 'active']],
    ['supersede an active note', 'superseded', ['superseded', 'active']],
  ] as const)('may %s: the UPDATE matches on the states that may become it', async (_what, to, from) => {
    const { updateWhere } = mockRefusedMove(null)

    await updateProjectMemoryItem(owner, 'item-1', { status: to })

    expect(updateWhere).toHaveBeenCalledWith(
      and(eq('pm.id', 'item-1'), and(eq('pm.projectId', 'proj-1'), openOnly), inArray('pm.status', [...from]))
    )
  })

  it('answers 409 invalid-transition for a dismissed note asked to become superseded', async () => {
    mockRefusedMove('dismissed')

    const move = updateProjectMemoryItem(owner, 'item-1', { status: 'superseded' })

    await expect(move).rejects.toBeInstanceOf(ConflictError)
    await expect(move).rejects.toMatchObject({
      status: 409,
      message: 'A dismissed note cannot become superseded',
      details: { reason: 'invalid-transition', from: 'dismissed', to: 'superseded', allowed: ['active'] },
    })
  })

  it('stays a null (the route’s 404) for a note the caller cannot reach', async () => {
    mockRefusedMove(null)
    expect(await updateProjectMemoryItem(owner, 'item-1', { status: 'dismissed' })).toBeNull()
  })
})

describe('a note is stored masked (ADR-0086)', () => {
  const IBAN = 'AT61 1904 3002 3457 3201'

  it('masks an edited note against the office policy before it is written', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'item-1' }])
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    vi.mocked(getDb).mockReturnValue(asDb({ update: vi.fn().mockReturnValue({ set }) }))

    await updateProjectMemoryItem(
      { projectId: 'proj-1', organizationId: 'org-1', readableFolderIds: [] },
      'item-1',
      { content: `Honorar laut Honorarvereinbarung an ${IBAN}` }
    )
    await updateProjectMemoryItem({ organizationId: 'org-1' }, 'item-2', { content: `Konto ${IBAN}` })

    expect(set.mock.calls.map(([patch]) => (patch as { content: string }).content)).toEqual([
      'Honorar laut [Begriff entfernt] an [IBAN entfernt]',
      'Konto [IBAN entfernt]',
    ])
  })

  it('leaves an edit without text alone', async () => {
    const returning = vi.fn().mockResolvedValue([{ id: 'item-1' }])
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    vi.mocked(getDb).mockReturnValue(asDb({ update: vi.fn().mockReturnValue({ set }) }))

    await updateProjectMemoryItem({ organizationId: 'org-1' }, 'item-1', { pinned: true })

    expect(set.mock.calls[0][0]).not.toHaveProperty('content')
  })
})

describe('an edited note is matched by what it says now', () => {
  const mockEdit = (edited: unknown[], embedded: unknown[] = edited) => {
    const returning = vi.fn().mockResolvedValueOnce(edited).mockResolvedValueOnce(embedded)
    const where = vi.fn().mockReturnValue({ returning })
    const set = vi.fn().mockReturnValue({ where })
    vi.mocked(getDb).mockReturnValue(asDb({ update: vi.fn().mockReturnValue({ set }) }))
    return { set, where, returning }
  }
  const owner = { projectId: 'proj-1', organizationId: 'org-1', readableFolderIds: [] }

  beforeEach(() => {
    vi.mocked(embedNote).mockReset().mockResolvedValue(null)
  })

  it('drops the old vector in the statement that changes the text', async () => {
    const { set } = mockEdit([makeMemoryItem({ id: 'item-1', content: 'Die Attika ist 1,20 m hoch' })])

    await updateProjectMemoryItem(owner, 'item-1', { content: 'Die Attika ist 1,20 m hoch' })

    expect(set).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        content: 'Die Attika ist 1,20 m hoch',
        embedding: null,
        embeddingModel: null,
        embeddedAt: null,
      })
    )
  })

  it('embeds the new text and stores the vector only while the row still holds that text', async () => {
    const edited = makeMemoryItem({ id: 'item-1', kind: 'derived_fact', content: 'Die Attika ist 1,20 m hoch' })
    const stored = { ...edited, embeddingModel: 'model-a' }
    const { set, where } = mockEdit([edited], [stored])
    vi.mocked(embedNote).mockResolvedValue({ vector: [0.1, 0.2], fingerprint: 'model-a' })

    const result = await updateProjectMemoryItem(owner, 'item-1', { content: 'Die Attika ist 1,20 m hoch' })

    expect(embedNote).toHaveBeenCalledWith('[derived_fact] Die Attika ist 1,20 m hoch')
    expect(set).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ embedding: [0.1, 0.2], embeddingModel: 'model-a' })
    )
    expect(where).toHaveBeenNthCalledWith(
      2,
      and(eq('pm.id', 'item-1'), eq('pm.content', 'Die Attika ist 1,20 m hoch'))
    )
    expect(result).toBe(stored)
  })

  it('keeps the vector when the edit changes neither text nor kind', async () => {
    const { set } = mockEdit([makeMemoryItem({ id: 'item-1' })])

    await updateProjectMemoryItem(owner, 'item-1', { pinned: true })

    expect(set).toHaveBeenCalledTimes(1)
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ embedding: null }))
    expect(embedNote).not.toHaveBeenCalled()
  })

  it('answers the edited row when no embedder is reachable; the backfill embeds it later', async () => {
    const edited = makeMemoryItem({ id: 'item-1', content: 'Neu' })
    const { set } = mockEdit([edited])

    expect(await updateProjectMemoryItem(owner, 'item-1', { content: 'Neu' })).toBe(edited)
    expect(set).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['a project note', owner],
    ['an organization note', { organizationId: 'org-1' }],
  ])('answers 409 when another note of the shelf already says the edited text (%s)', async (_what, shelf) => {
    const returning = vi.fn().mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }))
    const set = vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning }) })
    vi.mocked(getDb).mockReturnValue(asDb({ update: vi.fn().mockReturnValue({ set }) }))

    const edit = updateProjectMemoryItem(shelf, 'item-1', { content: 'Die Attika ist 1,20 m hoch' })

    await expect(edit).rejects.toBeInstanceOf(ConflictError)
    await expect(edit).rejects.toMatchObject({ status: 409, message: 'Another note already says this' })
  })
})
