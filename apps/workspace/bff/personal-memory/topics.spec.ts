/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./repository', () => ({
  selectPersonalMemory: vi.fn(async () => []),
  selectPersonalTopics: vi.fn(async () => []),
  findPersonalMemoryByContentKey: vi.fn(async () => null),
  insertPersonalMemory: vi.fn(),
  touchPersonalMemory: vi.fn(),
  updatePersonalMemory: vi.fn(),
  deletePersonalMemory: vi.fn(),
  deleteAllPersonalMemory: vi.fn(),
  movePersonalTopic: vi.fn(async () => 0),
  deletePersonalTopic: vi.fn(async () => 0),
}))
vi.mock('@/lib/upload-screening/service', () => ({
  maskChatText: vi.fn(async (_org: string, text: string) => ({ text })),
}))

import type { PersonalMemoryItem } from '@/lib/db/schema/personal-memory'
import {
  deletePersonalTopic,
  findPersonalMemoryByContentKey,
  insertPersonalMemory,
  movePersonalTopic,
  selectPersonalTopics,
  updatePersonalMemory,
} from './repository'
import {
  createPersonalMemoryItem,
  editPersonalMemoryItem,
  listPersonalMemoryTopics,
  removePersonalMemoryTopic,
  renamePersonalMemoryTopic,
} from './service'

const OWNER = { organizationId: 'org_1', userId: 'user_1' }

/** The person's notes, as the topic column holds them. */
function shelf(...topics: (string | null)[]) {
  vi.mocked(selectPersonalTopics).mockResolvedValue(topics.map((topic) => ({ topic })))
}

function storedNote(overrides: Partial<PersonalMemoryItem> = {}): PersonalMemoryItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: 'org_1',
    userId: 'user_1',
    kind: 'profile',
    content: 'Leads the fire-safety reviews.',
    contentKey: 'leads the fire safety reviews',
    provenanceType: 'agent',
    sourceConversationId: null,
    sourceMessageId: null,
    topic: null,
    pinned: false,
    createdAt: new Date('2026-11-01T10:00:00Z'),
    updatedAt: new Date('2026-11-01T10:00:00Z'),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  shelf()
  vi.mocked(findPersonalMemoryByContentKey).mockResolvedValue(null)
})

describe('a personal note is filed under a topic the person already has', () => {
  it('stores the spelling the person already uses, whatever case the agent wrote', async () => {
    shelf('Brandschutz')
    vi.mocked(insertPersonalMemory).mockImplementation(async (values) => storedNote(values as Partial<PersonalMemoryItem>))

    await createPersonalMemoryItem(OWNER, {
      kind: 'profile',
      content: 'Leads the fire-safety reviews.',
      provenanceType: 'agent',
      topic: 'brandschutz',
    })

    expect(insertPersonalMemory).toHaveBeenCalledWith(expect.objectContaining({ topic: 'Brandschutz' }))
  })

  it('stores a new topic as written, and no topic when none is named', async () => {
    vi.mocked(insertPersonalMemory).mockImplementation(async (values) => storedNote(values as Partial<PersonalMemoryItem>))

    await createPersonalMemoryItem(OWNER, { kind: 'profile', content: 'Leads the reviews.', provenanceType: 'agent', topic: ' Stellplätze ' })
    expect(insertPersonalMemory).toHaveBeenLastCalledWith(expect.objectContaining({ topic: 'Stellplätze' }))

    await createPersonalMemoryItem(OWNER, { kind: 'profile', content: 'Signs the submissions.', provenanceType: 'agent' })
    expect(insertPersonalMemory).toHaveBeenLastCalledWith(expect.objectContaining({ topic: null }))
  })

  it('moves an edited note to the topic it names, and takes it out with null', async () => {
    shelf('Bauherr')
    vi.mocked(updatePersonalMemory).mockResolvedValue(storedNote())

    await editPersonalMemoryItem(OWNER, 'note-1', { topic: '  bauherr ' })
    expect(updatePersonalMemory).toHaveBeenLastCalledWith(OWNER, 'note-1', { topic: 'Bauherr' })

    await editPersonalMemoryItem(OWNER, 'note-1', { topic: null })
    expect(updatePersonalMemory).toHaveBeenLastCalledWith(OWNER, 'note-1', { topic: null })
  })

  it('leaves the topic alone when the edit names none', async () => {
    vi.mocked(updatePersonalMemory).mockResolvedValue(storedNote())

    await editPersonalMemoryItem(OWNER, 'note-1', { pinned: true })

    expect(updatePersonalMemory).toHaveBeenLastCalledWith(OWNER, 'note-1', { pinned: true })
  })

  it('refuses a topic longer than 40 characters (400) before anything is written', async () => {
    await expect(
      createPersonalMemoryItem(OWNER, { kind: 'profile', content: 'Leads the reviews.', provenanceType: 'agent', topic: 'x'.repeat(41) })
    ).rejects.toMatchObject({ status: 400 })
    expect(insertPersonalMemory).not.toHaveBeenCalled()
  })
})

describe('listPersonalMemoryTopics', () => {
  it('counts each topic over all of the person’s notes, most notes first', async () => {
    shelf('Stellplätze', null, 'Brandschutz', 'Brandschutz')

    await expect(listPersonalMemoryTopics(OWNER)).resolves.toEqual([
      { name: 'Brandschutz', count: 2 },
      { name: 'Stellplätze', count: 1 },
    ])
    expect(selectPersonalTopics).toHaveBeenCalledWith(OWNER)
  })
})

describe('renamePersonalMemoryTopic', () => {
  it('moves the person’s notes on the topic to the new name, for the owner handed in only', async () => {
    shelf('Brandschutz', 'Stellplätze')
    vi.mocked(movePersonalTopic).mockResolvedValue(3)

    await expect(
      renamePersonalMemoryTopic(OWNER, { from: 'brandschutz', to: 'Feuerschutz' })
    ).resolves.toEqual({ moved: 3 })
    expect(movePersonalTopic).toHaveBeenCalledWith(OWNER, 'Brandschutz', 'Feuerschutz')
  })

  it('merges into a topic the person already has, in any case', async () => {
    shelf('Brandschutz', 'Stellplätze')

    await renamePersonalMemoryTopic(OWNER, { from: 'Brandschutz', to: 'STELLPLÄTZE' })

    expect(movePersonalTopic).toHaveBeenCalledWith(OWNER, 'Brandschutz', 'Stellplätze')
  })

  it('changes the case of a topic: the topic being renamed is not its own merge target', async () => {
    shelf('brandschutz')

    await renamePersonalMemoryTopic(OWNER, { from: 'brandschutz', to: 'Brandschutz' })

    expect(movePersonalTopic).toHaveBeenCalledWith(OWNER, 'brandschutz', 'Brandschutz')
  })

  it('ungroups the notes with to null, and groups the notes with no topic with from null', async () => {
    shelf('Bauherr')

    await renamePersonalMemoryTopic(OWNER, { from: 'Bauherr', to: null })
    expect(movePersonalTopic).toHaveBeenLastCalledWith(OWNER, 'Bauherr', null)

    await renamePersonalMemoryTopic(OWNER, { from: null, to: 'Bauherr' })
    expect(movePersonalTopic).toHaveBeenLastCalledWith(OWNER, null, 'Bauherr')
  })

  it('answers zero when no note of the person is on the topic', async () => {
    shelf()
    vi.mocked(movePersonalTopic).mockResolvedValue(0)

    await expect(renamePersonalMemoryTopic(OWNER, { from: 'Nichts', to: 'Anderes' })).resolves.toEqual({ moved: 0 })
  })

  it('writes nothing when the rename lands on its own name, and answers zero', async () => {
    shelf('Brandschutz')

    await expect(renamePersonalMemoryTopic(OWNER, { from: 'Brandschutz', to: 'Brandschutz' })).resolves.toEqual({ moved: 0 })
    await expect(renamePersonalMemoryTopic(OWNER, { from: null, to: null })).resolves.toEqual({ moved: 0 })

    expect(movePersonalTopic).not.toHaveBeenCalled()
  })

  it('still changes the case of a topic: the case-only rename is a change', async () => {
    shelf('brandschutz')
    vi.mocked(movePersonalTopic).mockResolvedValue(1)

    await expect(renamePersonalMemoryTopic(OWNER, { from: 'brandschutz', to: 'Brandschutz' })).resolves.toEqual({ moved: 1 })
    expect(movePersonalTopic).toHaveBeenCalledWith(OWNER, 'brandschutz', 'Brandschutz')
  })

  it('refuses an empty from (400) before any note is read or moved', async () => {
    await expect(renamePersonalMemoryTopic(OWNER, { from: '', to: 'Feuerschutz' })).rejects.toMatchObject({ status: 400 })
    await expect(renamePersonalMemoryTopic(OWNER, { from: '   ', to: 'Feuerschutz' })).rejects.toMatchObject({ status: 400 })

    expect(selectPersonalTopics).not.toHaveBeenCalled()
    expect(movePersonalTopic).not.toHaveBeenCalled()
  })
})

describe('removePersonalMemoryTopic', () => {
  it('deletes the notes of the person on the topic, matched by its stored spelling', async () => {
    shelf('Stellplätze')
    vi.mocked(deletePersonalTopic).mockResolvedValue(2)

    await expect(removePersonalMemoryTopic(OWNER, 'STELLPLÄTZE')).resolves.toEqual({ removed: 2 })
    expect(deletePersonalTopic).toHaveBeenCalledWith(OWNER, 'Stellplätze')
  })

  it('removes nothing for a blank name, and never reaches the database', async () => {
    await expect(removePersonalMemoryTopic(OWNER, '   ')).resolves.toEqual({ removed: 0 })
    expect(deletePersonalTopic).not.toHaveBeenCalled()
  })
})
