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
  rows: [] as { topic: string | null }[],
  /** What each update set, and the id list its WHERE named. */
  sets: [] as unknown[],
  updatedIds: [] as string[][],
}))

vi.mock('server-only', () => ({}))

// The conditions are recorded as data, so the test reads which ids the update named.
vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    and: (...conditions: unknown[]) => ({ conditions }),
    inArray: (_column: unknown, ids: string[]) => ({ ids }),
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
  memoryVisibleTo: vi.fn(() => 'visible'),
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
    select: () => ({ from: () => ({ where: async () => h.rows }) }),
  }),
}))

import { renameProjectShelfTopic, resolveProjectTopicForWrite } from './memory-topics'
import { listProjectMemory } from './memory-service'

const PROJECT = 'proj_1'
const ORG = 'org_1'

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

    await renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: [], from: 'Brandschutz', to: 'STELLPLÄTZE' })

    expect(h.sets).toEqual([{ topic: 'Stellplätze' }])
  })

  it('does not offer a restricted note’s topic to an open note: the name is written as typed', async () => {
    h.listed = [note('open-1', 'Brandschutz'), note('restricted-1', 'Bauherr', { restrictedFolderIds: ['f1'] })]

    await renameProjectShelfTopic({ projectId: PROJECT, organizationId: ORG, readable: ['f1'], from: 'Brandschutz', to: 'bauherr' })

    expect(h.sets).toEqual([{ topic: 'bauherr' }])
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
