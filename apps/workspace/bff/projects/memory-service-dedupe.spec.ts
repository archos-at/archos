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
import { embedNote } from '@/lib/knowledge/embeddings'
import { asDb, makeMemoryItem } from '@/test-utils/db-fixtures'
import { createProjectMemoryItem } from './memory-service'
import { and, eq, supersedable } from './memory-service.fixtures'
import { mockNearDupChain, mockSupersedeChain } from './memory-service-db.fixtures'

beforeEach(() => {
  vi.mocked(getDb).mockReset()
})

describe('createProjectMemoryItem write-time de-duplication', () => {
  const mockCreateChain = (existing: unknown | null) => {
    const limit = vi.fn().mockResolvedValue(existing ? [existing] : [])
    const orderBy = vi.fn().mockReturnValue({ limit })
    const selectWhere = vi.fn().mockReturnValue({ orderBy })
    const from = vi.fn().mockReturnValue({ where: selectWhere })

    const updateReturning = vi.fn().mockResolvedValue([{ id: 'dup-1', confidence: 'high' }])
    const updateWhere = vi.fn().mockReturnValue({ returning: updateReturning })
    const set = vi.fn().mockReturnValue({ where: updateWhere })
    const update = vi.fn().mockReturnValue({ set })

    const insertReturning = vi.fn().mockResolvedValue([{ id: 'new-1' }])
    const values = vi.fn().mockReturnValue({ returning: insertReturning })
    const insert = vi.fn().mockReturnValue({ values })

    vi.mocked(getDb).mockReturnValue(
      asDb({
        select: vi.fn().mockReturnValue({ from }),
        update,
        insert,
      })
    )
    return { set, values, insert, update }
  }

  it('stores, embeds and de-duplicates a new note by its masked text (ADR-0086)', async () => {
    const { values } = mockCreateChain(null)
    vi.mocked(embedNote).mockClear()

    await createProjectMemoryItem({
      scope: 'organization',
      projectId: null,
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'Lohnzettel gehen an AT61 1904 3002 3457 3201.',
    })

    expect((values.mock.calls[0][0] as { content: string }).content).toBe(
      '[Begriff entfernt] gehen an [IBAN entfernt].'
    )
    expect(String(vi.mocked(embedNote).mock.calls[0][0])).not.toContain('AT61')
  })

  it('inserts when no active duplicate exists', async () => {
    const { values, set } = mockCreateChain(null)

    const result = await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'The roof load is 2 kN/m².',
    })

    expect(result).toEqual({ id: 'new-1' })
    expect(values).toHaveBeenCalledTimes(1)
    expect(set).not.toHaveBeenCalled()
  })

  it('refreshes rather than duplicating when a colleague already saved the same memory', async () => {
    const { values, set } = mockCreateChain({ id: 'existing-1', confidence: 'medium', content: 'The roof load is 2 kN/m².' })

    const result = await createProjectMemoryItem({
      scope: 'organization',
      projectId: null,
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'The roof load is 2 kN/m².',
      confidence: 'high',
    })

    expect(values).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'high' }))
    expect(result).toBeDefined()
  })

  it('treats a concurrent unique-violation (23505) as a duplicate and returns the winner', async () => {
    const limit = vi
      .fn()
      .mockResolvedValueOnce([]) // exact-dup pre-check: no duplicate
      .mockResolvedValueOnce([]) // near-dup scan: no candidates
      .mockResolvedValueOnce([{ id: 'winner-1' }]) // post-violation re-check
    const orderBy = vi.fn().mockReturnValue({ limit })
    const selectWhere = vi.fn().mockReturnValue({ orderBy })
    const from = vi.fn().mockReturnValue({ where: selectWhere })
    const insertReturning = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error('dup'), { code: '23505' }))
    const values = vi.fn().mockReturnValue({ returning: insertReturning })
    vi.mocked(getDb).mockReturnValue(
      asDb({
        select: vi.fn().mockReturnValue({ from }),
        insert: vi.fn().mockReturnValue({ values }),
      })
    )

    const result = await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'Racy content wins the race.',
    })

    expect(result).toEqual({ id: 'winner-1' })
  })

  it('refreshes the existing row (no insert) when a normalized-equal item exists', async () => {
    const { values, set, update } = mockCreateChain({ id: 'dup-1', confidence: 'medium', content: 'The roof load is 2 kN/m2' })

    const result = await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'the ROOF load is  2 kN/m2!',
      confidence: 'high',
    })

    expect(update).toHaveBeenCalledTimes(1)
    expect(values).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'high' }))
    expect(result).toEqual({ id: 'dup-1', confidence: 'high' })
  })
})

describe('createProjectMemoryItem paraphrase de-duplication', () => {
  it('merges a restated same-kind finding into the existing row instead of inserting', async () => {
    const { set, values } = mockNearDupChain([
      {
        id: 'dup-1',
        kind: 'constraint',
        confidence: 'medium',
        content: 'The client requires fire resistance class REI 90 for the hall',
      },
    ])

    const result = await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'constraint',
      content: 'Client requires fire resistance class REI 90 for the hall building',
      confidence: 'high',
    })

    expect(values).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'high' }))
    expect(result).toEqual({ id: 'dup-1', confidence: 'high' })
  })

  it('inserts when a topically similar finding shares too few tokens', async () => {
    const { values, set } = mockNearDupChain([
      {
        id: 'other-1',
        kind: 'constraint',
        confidence: 'medium',
        content: 'The client requires a sprinkler system in the underground garage',
      },
    ])

    const result = await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'constraint',
      content: 'Client requires fire resistance class REI 90 for the hall building',
    })

    expect(result).toEqual({ id: 'new-1' })
    expect(values).toHaveBeenCalledTimes(1)
    expect(set).not.toHaveBeenCalled()
  })

  it('supersedes rather than merges when the finding negates the existing one', async () => {
    const stale = makeMemoryItem({
      id: 'stale-1',
      kind: 'derived_fact',
      content: 'For Bergsteiggasse, OIB-RL 2.1 is not applicable to this project',
    })
    const { values, set, transaction, txSet, txWhere } = mockSupersedeChain([[], [stale]])

    const result = await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'For Bergsteiggasse, OIB-RL 2.1 is applicable to this project',
      confidence: 'high',
    })

    expect(result).toEqual({ id: 'new-1' })
    expect(set).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ supersedesId: 'stale-1' }))
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(txSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }))
    expect(txWhere).toHaveBeenCalledWith(and(eq('pm.id', 'stale-1'), supersedable))
  })

  it('treats a flipped boolean flag as a contradiction, not a restatement', async () => {
    const stale = makeMemoryItem({
      id: 'stale-2',
      kind: 'derived_fact',
      content:
        'For Bergsteiggasse (Wohnen + Buero, betriebsanlage=false) OIB-RL 2.1 is generally not ' +
        'applicable and OIB-RL 2 remains decisive',
    })
    const { values, set } = mockSupersedeChain([[], [stale]])

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      content:
        'For Bergsteiggasse (Wohnen + Buero, betriebsanlage=true) OIB-RL 2.1 is generally not ' +
        'applicable and OIB-RL 2 remains decisive',
    })

    expect(set).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ supersedesId: 'stale-2' }))
  })

  it('still merges a restatement that carries the same polarity', async () => {
    const existing = makeMemoryItem({
      id: 'dup-1',
      kind: 'constraint',
      content: 'The hall does not need a sprinkler system per the client',
    })
    const { values, set } = mockSupersedeChain([[], [existing]])

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'constraint',
      content: 'The hall does not need a sprinkler system per the client brief',
      confidence: 'high',
    })

    expect(values).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'high' }))
  })

  it.each([
    [
      'a dimension',
      'Die Attika im Bauteil B ist laut Schnitt A-A 1,10 m hoch.',
      'Die Attika im Bauteil B ist laut Schnitt A-A 1,20 m hoch.',
    ],
    [
      'a date',
      'Die Bauverhandlung im Projekt Lindengasse findet laut Bescheid der Baupolizei am 12.03.2027 statt.',
      'Die Bauverhandlung im Projekt Lindengasse findet laut Bescheid der Baupolizei am 19.03.2027 statt.',
    ],
    [
      'a quantity with its unit',
      'Die Decke im Lager Bauteil C traegt laut Statik vom Buero Huber 5 kN/m2 Nutzlast.',
      'Die Decke im Lager Bauteil C traegt laut Statik vom Buero Huber 7,5 kN/m2 Nutzlast.',
    ],
    [
      'a count',
      'Im Bauteil A sind laut Einreichplan vom Buero Huber insgesamt 24 Wohnungen und zwei Stiegenhaeuser geplant.',
      'Im Bauteil A sind laut Einreichplan vom Buero Huber insgesamt 26 Wohnungen und zwei Stiegenhaeuser geplant.',
    ],
    [
      'a count written as a word',
      'Im Bauteil A sind laut Einreichplan vom Buero Huber insgesamt 24 Wohnungen und zwei Stiegenhaeuser geplant.',
      'Im Bauteil A sind laut Einreichplan vom Buero Huber insgesamt 24 Wohnungen und drei Stiegenhaeuser geplant.',
    ],
    [
      'a named alternative',
      'Die Fassade im Bauteil B wird laut Beschluss der Bauherrin in Laerche ausgefuehrt.',
      'Die Fassade im Bauteil B wird laut Beschluss der Bauherrin in Eiche ausgefuehrt.',
    ],
    [
      'two numbers that changed places',
      'Im Bauteil A sind laut Einreichplan vom Buero Huber 2 Stiegen und 3 Aufzuege geplant.',
      'Im Bauteil A sind laut Einreichplan vom Buero Huber 3 Stiegen und 2 Aufzuege geplant.',
    ],
  ])('supersedes when a near-duplicate changes %s', async (_what, before, after) => {
    const stale = makeMemoryItem({ id: 'stale-1', kind: 'derived_fact', content: before })
    const { values, set, transaction, txSet, txWhere } = mockSupersedeChain([[], [stale]])
    const superseded: string[] = []

    const result = await createProjectMemoryItem(
      { scope: 'project', projectId: 'proj-1', organizationId: 'org-1', kind: 'derived_fact', content: after },
      { onSuperseded: (id) => superseded.push(id) }
    )

    expect(result).toEqual({ id: 'new-1' })
    expect(set).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ content: after, supersedesId: 'stale-1' }))
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(txSet).toHaveBeenCalledWith(expect.objectContaining({ status: 'superseded' }))
    expect(txWhere).toHaveBeenCalledWith(and(eq('pm.id', 'stale-1'), supersedable))
    expect(superseded).toEqual(['stale-1'])
  })

  it('records the corrected value beside a human-curated note instead of dropping it', async () => {
    const human = makeMemoryItem({
      id: 'human-1',
      kind: 'derived_fact',
      provenanceType: 'user',
      verification: 'user_confirmed',
      content: 'Die Attika im Bauteil B ist laut Schnitt A-A 1,10 m hoch.',
    })
    const { values, set, txSet } = mockSupersedeChain([[], [human]])

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'Die Attika im Bauteil B ist laut Schnitt A-A 1,20 m hoch.',
    })

    expect(set).not.toHaveBeenCalled()
    expect(txSet).not.toHaveBeenCalled()
    expect(values).toHaveBeenCalledWith(expect.objectContaining({ conflictsWithId: 'human-1' }))
  })

  it('merges a near-duplicate that only adds words: no word of the held note was swapped', async () => {
    const held = makeMemoryItem({
      id: 'held-1',
      kind: 'constraint',
      content: 'The client requires fire resistance class REI 90 for the hall',
    })
    const { values, set, txWhere } = mockSupersedeChain([[], [held]])

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'constraint',
      content: 'The client requires fire resistance class REI 90 for the hall building',
    })

    expect(values).not.toHaveBeenCalled()
    expect(txWhere).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.not.objectContaining({ content: expect.anything() }))
  })

  it('retires both the near-duplicate it corrects and the entry the caller named', async () => {
    const stale = makeMemoryItem({
      id: 'stale-1',
      kind: 'derived_fact',
      content: 'Die Attika im Bauteil B ist laut Schnitt A-A 1,10 m hoch.',
    })
    const named = makeMemoryItem({ id: 'named-1', kind: 'constraint', content: 'Attikahoehe ist noch offen' })
    const { values, txWhere } = mockSupersedeChain([[], [stale], [named], [named]])
    const superseded: string[] = []

    await createProjectMemoryItem(
      {
        scope: 'project',
        projectId: 'proj-1',
        organizationId: 'org-1',
        kind: 'derived_fact',
        content: 'Die Attika im Bauteil B ist laut Schnitt A-A 1,20 m hoch.',
      },
      { supersedesContent: 'Attikahoehe ist noch offen', onSuperseded: (id) => superseded.push(id) }
    )

    expect(values).toHaveBeenCalledWith(expect.objectContaining({ supersedesId: 'stale-1' }))
    expect(txWhere).toHaveBeenCalledWith(and(eq('pm.id', 'named-1'), supersedable))
    expect(superseded).toEqual(['stale-1', 'named-1'])
  })

  it('takes the incoming text when the index calls two notes equal that assert different bounds', async () => {
    const held = makeMemoryItem({ id: 'dup-1', kind: 'constraint', content: 'Fluchtweg im Bauteil B: ≥ 40 m' })
    const { values, set } = mockSupersedeChain([[held]])

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'constraint',
      content: 'Fluchtweg im Bauteil B: ≤ 40 m',
    })

    expect(values).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Fluchtweg im Bauteil B: ≤ 40 m', embedding: null, embeddingModel: null })
    )
  })

  it('keeps the old text when the new note says nothing the old one does not', async () => {
    const existing = makeMemoryItem({
      id: 'dup-1',
      kind: 'derived_fact',
      content: 'Die Attika im Bauteil B ist laut Schnitt A-A vom Buero Huber 1,10 m hoch.',
    })
    const { values, set } = mockSupersedeChain([[], [existing]])

    await createProjectMemoryItem({
      scope: 'project',
      projectId: 'proj-1',
      organizationId: 'org-1',
      kind: 'derived_fact',
      content: 'Attika im Bauteil B ist laut Schnitt A-A vom Buero Huber 1,1 m hoch',
      confidence: 'high',
    })

    expect(values).not.toHaveBeenCalled()
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ confidence: 'high' }))
    expect(set).not.toHaveBeenCalledWith(expect.objectContaining({ content: expect.anything() }))
  })
})
