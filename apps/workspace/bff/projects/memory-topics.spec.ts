/**
 * @vitest-environment node
 *
 * The project shelf's topics (ADR-0180, ADR-0087): a rename touches only the
 * notes the reader can see, and a write never offers a restricted note's topic
 * to an open note. The list path and the update are the subject here; the
 * statements' visibility is the database's and `memory-restricted.integration.spec.ts`'s.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  listed: [] as Record<string, unknown>[],
  rows: [] as Record<string, unknown>[],
  /** What each update set, and the id list its WHERE named. */
  sets: [] as unknown[],
  updatedIds: [] as string[][],
}))

vi.mock('server-only', () => ({}))

// The conditions are recorded as data, so the test reads which ids the update named,
// and a select's rows are filtered by the visibility and the note id its WHERE names.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    and: (...conditions: unknown[]) => ({ conditions }),
    or: (...conditions: unknown[]) => ({ or: conditions }),
    inArray: (_column: unknown, ids: string[]) => ({ ids }),
    eq: (column: { name: string }, value: unknown) => ({ column: column.name, value }),
  }
})

vi.mock('./memory-service', () => ({
  // Honours the readable folders the way the list path does: a restricted note only for a reader cleared for all of it.
  listProjectMemory: vi.fn(async (_projectId: string, options: { readableFolderIds?: readonly string[] }) =>
    h.listed.filter((item) => {
      const restricted = (item.restrictedFolderIds as string[] | null) ?? []
      return restricted.every((folder) => (options.readableFolderIds ?? []).includes(folder))
    })
  ),
  memoryVisibleTo: vi.fn((readable: readonly string[] = []) => ({ visibleTo: readable })),
  resolveProjectOrganization: vi.fn(async () => 'org_1'),
}))

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    update: () => ({
      set: (values: unknown) => {
        h.sets.push(values)
        return {
          where: (condition: { conditions: { ids?: string[] }[] }) => {
            const ids = condition.conditions.find((part) => 'ids' in part)?.ids ?? []
            h.updatedIds.push(ids)
            return { returning: async () => ids.map((id) => ({ id })) }
          },
        }
      },
    }),
    select: () => ({
      from: () => ({
        where: async (condition: { conditions: Record<string, unknown>[] }) =>
          h.rows.filter((row) => rowPasses(row, condition)),
      }),
    }),
  }),
}))

import {
  isRestrictedShelfNote,
  projectTopicsOf,
  renameProjectShelfTopic,
  resolveProjectTopicForWrite,
} from './memory-topics'
import { listProjectMemory } from './memory-service'

const PROJECT = 'proj_1'
const ORG = 'org_1'
const CONTRACTS = 'aaaaaaaa-0000-4000-8000-000000000001'
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002'

/** A row of the fake select: visible to a reader cleared for all of its folders, and the one note an `id` condition names. */
function rowPasses(row: Record<string, unknown>, condition: { conditions: Record<string, unknown>[] }): boolean {
  return condition.conditions.every((part) => {
    if ('visibleTo' in part) {
      const restricted = (row.restrictedFolderIds as string[] | null | undefined) ?? []
      return restricted.every((folder) => (part.visibleTo as string[]).includes(folder))
    }
    return part.column !== 'id' || row.id === part.value
  })
}

function note(id: string, topic: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id,
    scope: 'project',
    projectId: PROJECT,
    organizationId: ORG,
    topic,
    status: 'active',
    restrictedFolderIds: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.listed = []
  h.rows = []
  h.sets = []
  h.updatedIds = []
})

describe('projectTopicsOf', () => {
  it('counts the topics of the notes the list shows: the restricted ones only for a reader cleared for them', async () => {
    h.rows = [
      { topic: 'Brandschutz', restrictedFolderIds: null },
      { topic: 'Bauordnung', restrictedFolderIds: null },
      { topic: 'Brandschutz', restrictedFolderIds: [CONTRACTS] },
    ]

    await expect(projectTopicsOf(PROJECT, ORG, [])).resolves.toEqual([
      { name: 'Bauordnung', count: 1 },
      { name: 'Brandschutz', count: 1 },
    ])
    await expect(projectTopicsOf(PROJECT, ORG, [CONTRACTS])).resolves.toEqual([
      { name: 'Brandschutz', count: 2 },
      { name: 'Bauordnung', count: 1 },
    ])
  })
})

describe('renameProjectShelfTopic', () => {
  it('moves the notes the reader sees on the topic, archived ones included, and no others', async () => {
    h.listed = [
      note('open-1', 'Brandschutz'),
      note('archived-1', 'Brandschutz', { status: 'dismissed' }),
      note('restricted-1', 'Brandschutz', { restrictedFolderIds: ['f1'] }),
      note('other-topic', 'Stellplätze'),
      // An office note on the same name is another shelf and never moves.
      note('office-1', 'Brandschutz', { scope: 'organization', projectId: null }),
    ]

    const result = await renameProjectShelfTopic({
      projectId: PROJECT,
      organizationId: ORG,
      readable: ['f1'],
      from: 'Brandschutz',
      to: 'Feuerschutz',
    })

    expect(listProjectMemory).toHaveBeenCalledWith(PROJECT, expect.objectContaining({ includeArchived: true, readableFolderIds: ['f1'] }))
    expect(result).toEqual({ moved: 3 })
    expect(h.sets).toEqual([{ topic: 'Feuerschutz' }])
    expect(h.updatedIds).toEqual([['open-1', 'archived-1', 'restricted-1']])
  })

  it('leaves a restricted note alone for a reader who is not cleared for all of its folders', async () => {
    h.listed = [note('open-1', 'Brandschutz'), note('restricted-1', 'Brandschutz', { restrictedFolderIds: ['f1'] })]

    const result = await renameProjectShelfTopic({
      projectId: PROJECT,
      organizationId: ORG,
      readable: [],
      from: 'Brandschutz',
      to: 'Feuerschutz',
    })

    expect(result).toEqual({ moved: 1 })
    expect(h.updatedIds).toEqual([['open-1']])
  })

  it('merges into an open topic the shelf already has, in any case', async () => {
    h.listed = [note('a', 'Brandschutz'), note('b', 'Stellplätze')]
    h.rows = [...h.listed]

    await renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'Brandschutz', to: 'STELLPLÄTZE' })

    expect(h.sets).toEqual([{ topic: 'Stellplätze' }])
  })

  it('merges into an open office topic: a rename resolves against the same open topics a create does', async () => {
    h.listed = [note('a', 'Stellplätze')]
    h.rows = [
      ...h.listed,
      note('office-1', 'Brandschutz', { scope: 'organization', projectId: null }),
    ]

    await renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'Stellplätze', to: 'BRANDSCHUTZ' })

    expect(h.sets).toEqual([{ topic: 'Brandschutz' }])
  })

  it('does not offer a restricted note’s topic to an open note: the name is written as typed', async () => {
    h.listed = [note('open-1', 'Brandschutz'), note('restricted-1', 'Bauherr', { restrictedFolderIds: ['f1'] })]
    h.rows = [...h.listed]

    await renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: ['f1'], from: 'Brandschutz', to: 'bauherr' })

    expect(h.sets).toEqual([{ topic: 'bauherr' }])
  })

  it('writes nothing when the rename lands on its own name, and answers zero', async () => {
    h.listed = [note('a', 'Brandschutz'), note('b', 'Brandschutz')]

    await expect(
      renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'Brandschutz', to: 'Brandschutz' })
    ).resolves.toEqual({ moved: 0 })
    await expect(
      renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'brandschutz', to: 'Brandschutz' })
    ).resolves.toEqual({ moved: 0 })

    expect(h.sets).toEqual([])
  })

  it('still renames a topic to another spelling of its own name: the case-only rename is a change', async () => {
    h.listed = [note('a', 'Brandschutz'), note('b', 'Brandschutz')]

    await expect(
      renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'Brandschutz', to: 'brandschutz' })
    ).resolves.toEqual({ moved: 2 })

    expect(h.sets).toEqual([{ topic: 'brandschutz' }])
  })

  it('refuses an empty from (400) before any note is read or written, so it never targets the notes with no topic', async () => {
    h.listed = [note('a', null)]

    await expect(
      renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: '', to: 'Brandschutz' })
    ).rejects.toMatchObject({ status: 400 })

    expect(listProjectMemory).not.toHaveBeenCalled()
    expect(h.sets).toEqual([])
  })

  it('takes notes out of their topic with to null, and answers zero for a topic nobody holds', async () => {
    h.listed = [note('a', 'Bauherr')]

    await expect(
      renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'Bauherr', to: null })
    ).resolves.toEqual({ moved: 1 })
    expect(h.sets).toEqual([{ topic: null }])

    h.sets = []
    await expect(
      renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'Nichts', to: 'Anderes' })
    ).resolves.toEqual({ moved: 0 })
    expect(h.sets).toEqual([])
  })
})

describe('resolveProjectTopicForWrite', () => {
  it('resolves against the open topics the shelf holds, so a restricted topic is not reused', async () => {
    h.rows = [{ topic: 'Brandschutz' }, { topic: null }]

    await expect(resolveProjectTopicForWrite(PROJECT, ORG, 'brandschutz')).resolves.toBe('Brandschutz')
    await expect(resolveProjectTopicForWrite(PROJECT, ORG, 'Bauherr')).resolves.toBe('Bauherr')
    await expect(resolveProjectTopicForWrite(PROJECT, ORG, null)).resolves.toBeNull()
  })
})

describe('resolveProjectTopicForWrite for a restricted note', () => {
  const shelf = [
    { topic: 'Brandschutz', restrictedFolderIds: null },
    { topic: 'Verträge', restrictedFolderIds: [CONTRACTS] },
    { topic: 'Honorare', restrictedFolderIds: [OTHER] },
  ]

  it('resolves against the restricted topics its writer is cleared for', async () => {
    h.rows = shelf

    await expect(resolveProjectTopicForWrite(PROJECT, ORG, 'verträge', [CONTRACTS])).resolves.toBe('Verträge')
  })

  it('never offers a restricted topic to an open note, even one its writer is cleared for', async () => {
    h.rows = shelf

    await expect(resolveProjectTopicForWrite(PROJECT, ORG, 'verträge', [])).resolves.toBe('verträge')
    await expect(resolveProjectTopicForWrite(PROJECT, ORG, 'brandschutz', [])).resolves.toBe('Brandschutz')
  })

  it('offers no restricted topic its writer is not cleared for', async () => {
    h.rows = shelf

    await expect(resolveProjectTopicForWrite(PROJECT, ORG, 'honorare', [CONTRACTS])).resolves.toBe('honorare')
  })
})

describe('isRestrictedShelfNote', () => {
  it('answers whether the note is restricted, for a reader who sees it', async () => {
    h.rows = [
      { id: 'restricted-1', topic: 'Verträge', restrictedFolderIds: [CONTRACTS] },
      { id: 'open-1', topic: 'Brandschutz', restrictedFolderIds: null },
    ]

    await expect(isRestrictedShelfNote(PROJECT, ORG, 'restricted-1', [CONTRACTS])).resolves.toBe(true)
    await expect(isRestrictedShelfNote(PROJECT, ORG, 'open-1', [CONTRACTS])).resolves.toBe(false)
  })

  it('answers false for a restricted note the reader is not cleared for, as for a missing one', async () => {
    h.rows = [{ id: 'restricted-1', topic: 'Verträge', restrictedFolderIds: [CONTRACTS] }]

    await expect(isRestrictedShelfNote(PROJECT, ORG, 'restricted-1', [])).resolves.toBe(false)
  })
})
