/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./repository', () => ({
  PERSONAL_MEMORY_LIST_LIMIT: 200,
  selectPersonalMemory: vi.fn(),
  selectPersonalTopics: vi.fn(async () => []),
  movePersonalTopic: vi.fn(),
  deletePersonalTopic: vi.fn(),
  findPersonalMemoryByContentKey: vi.fn(),
  insertPersonalMemory: vi.fn(),
  touchPersonalMemory: vi.fn(),
  updatePersonalMemory: vi.fn(),
  deletePersonalMemory: vi.fn(),
  deleteAllPersonalMemory: vi.fn(),
}))
// The office's screening (ADR-0086): here, a stand-in that masks one number.
vi.mock('@/lib/upload-screening/service', () => ({
  maskChatText: vi.fn(async (_org: string, text: string) => ({ text: text.replace(/AT\d{18}/g, '[IBAN]') })),
}))

import { BadRequestError, ConflictError } from '@/lib/api/errors'
import { UNIQUE_VIOLATION } from '@/lib/db/errors'
import type { PersonalMemoryItem } from '@/lib/db/schema/personal-memory'
import { maskChatText } from '@/lib/upload-screening/service'
import {
  deleteAllPersonalMemory,
  deletePersonalMemory,
  findPersonalMemoryByContentKey,
  insertPersonalMemory,
  selectPersonalMemory,
  touchPersonalMemory,
  updatePersonalMemory,
} from './repository'
import {
  PERSONAL_DIGEST_MAX_CHARS,
  PERSONAL_DIGEST_MAX_ITEMS,
  PERSONAL_MEMORY_DIGEST_HEADER,
  buildPersonalMemoryDigest,
  clearPersonalMemory,
  createPersonalMemoryItem,
  editPersonalMemoryItem,
  forgetPersonalMemoryItem,
  listPersonalMemory,
  removePersonalMemoryItem,
} from './service'

const OWNER = { organizationId: 'org_1', userId: 'user_1' }

function note(overrides: Partial<PersonalMemoryItem> = {}): PersonalMemoryItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    organizationId: 'org_1',
    userId: 'user_1',
    kind: 'preference',
    content: 'Answers in short paragraphs.',
    contentKey: 'answers in short paragraphs',
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

/** What the driver raises on the unique index, as drizzle wraps it: the SQLSTATE is on the cause. */
function uniqueViolation(): Error {
  return new Error('Failed query', { cause: Object.assign(new Error('duplicate key'), { code: UNIQUE_VIOLATION }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(findPersonalMemoryByContentKey).mockResolvedValue(null)
})

describe('createPersonalMemoryItem', () => {
  it('keeps a new note for the owner it was handed, with its provenance and conversation', async () => {
    vi.mocked(insertPersonalMemory).mockImplementation(async (values) => note(values as Partial<PersonalMemoryItem>))

    const result = await createPersonalMemoryItem(OWNER, {
      kind: 'profile',
      content: 'Leads the fire-safety reviews.',
      provenanceType: 'distillation',
      sourceConversationId: 's_1',
    })

    expect(result.created).toBe(true)
    expect(insertPersonalMemory).toHaveBeenCalledWith({
      organizationId: 'org_1',
      userId: 'user_1',
      kind: 'profile',
      content: 'Leads the fire-safety reviews.',
      contentKey: 'leads the fire safety reviews',
      provenanceType: 'distillation',
      pinned: false,
      sourceConversationId: 's_1',
      sourceMessageId: null,
      topic: null,
    })
  })

  it('stores the answer the agent saved the note under, and none for a note that belongs to no answer', async () => {
    vi.mocked(insertPersonalMemory).mockImplementation(async (values) => note(values as Partial<PersonalMemoryItem>))
    const answer = '4f9c1d2e-3b4a-5c5d-8e6f-7a8b9c0d1e2f'

    const kept = await createPersonalMemoryItem(OWNER, {
      kind: 'preference',
      content: 'Wants the sources first.',
      provenanceType: 'agent',
      sourceConversationId: 's_1',
      sourceMessageId: answer,
    })

    expect(kept.item.sourceMessageId).toBe(answer)
    expect(insertPersonalMemory).toHaveBeenLastCalledWith(expect.objectContaining({ sourceMessageId: answer }))
  })

  it('leaves a restated note under the answer it was first saved under', async () => {
    const first = note({ sourceMessageId: '11111111-2222-5333-8444-555555555555' })
    vi.mocked(findPersonalMemoryByContentKey).mockResolvedValue(first)
    vi.mocked(touchPersonalMemory).mockResolvedValue(first)

    const again = await createPersonalMemoryItem(OWNER, {
      kind: 'preference',
      content: first.content,
      provenanceType: 'agent',
      sourceMessageId: '4f9c1d2e-3b4a-5c5d-8e6f-7a8b9c0d1e2f',
    })

    expect(again).toEqual({ item: first, created: false })
    expect(insertPersonalMemory).not.toHaveBeenCalled()
  })

  it('refreshes the existing note when the text says the same once case and punctuation are folded', async () => {
    const existing = note()
    const touched = note({ updatedAt: new Date('2026-11-11T09:00:00Z') })
    vi.mocked(findPersonalMemoryByContentKey).mockResolvedValue(existing)
    vi.mocked(touchPersonalMemory).mockResolvedValue(touched)

    const result = await createPersonalMemoryItem(OWNER, {
      kind: 'preference',
      content: '  ANSWERS in short paragraphs!! ',
      provenanceType: 'agent',
    })

    expect(findPersonalMemoryByContentKey).toHaveBeenCalledWith(OWNER, 'answers in short paragraphs')
    expect(touchPersonalMemory).toHaveBeenCalledWith(OWNER, existing.id)
    expect(result).toEqual({ item: touched, created: false })
    expect(insertPersonalMemory).not.toHaveBeenCalled()
  })

  it('answers the existing note unchanged when it vanished between the lookup and the refresh', async () => {
    const existing = note()
    vi.mocked(findPersonalMemoryByContentKey).mockResolvedValue(existing)
    vi.mocked(touchPersonalMemory).mockResolvedValue(null)

    const result = await createPersonalMemoryItem(OWNER, { kind: 'preference', content: existing.content, provenanceType: 'agent' })

    expect(result).toEqual({ item: existing, created: false })
  })

  it('returns the winner when two turns kept the same sentence at once and the unique index let one in', async () => {
    const winner = note({ id: '22222222-2222-4222-8222-222222222222' })
    vi.mocked(findPersonalMemoryByContentKey).mockResolvedValueOnce(null).mockResolvedValueOnce(winner)
    vi.mocked(insertPersonalMemory).mockRejectedValue(uniqueViolation())

    const result = await createPersonalMemoryItem(OWNER, { kind: 'preference', content: winner.content, provenanceType: 'agent' })

    expect(result).toEqual({ item: winner, created: false })
    expect(findPersonalMemoryByContentKey).toHaveBeenCalledTimes(2)
  })

  it('rethrows a unique violation whose winner cannot be found, and any other failure', async () => {
    const violation = uniqueViolation()
    vi.mocked(insertPersonalMemory).mockRejectedValueOnce(violation)
    await expect(
      createPersonalMemoryItem(OWNER, { kind: 'preference', content: 'x', provenanceType: 'agent' })
    ).rejects.toBe(violation)

    const down = new Error('connection refused')
    vi.mocked(insertPersonalMemory).mockRejectedValueOnce(down)
    await expect(
      createPersonalMemoryItem(OWNER, { kind: 'preference', content: 'y', provenanceType: 'agent' })
    ).rejects.toBe(down)
  })

  it('stores the text as the office’s screening leaves it, and dedups on that text', async () => {
    vi.mocked(insertPersonalMemory).mockImplementation(async (values) => note(values as Partial<PersonalMemoryItem>))

    const { item } = await createPersonalMemoryItem(OWNER, {
      kind: 'profile',
      content: 'Pays invoices from AT611904300234573201.',
      provenanceType: 'user',
      pinned: true,
    })

    expect(maskChatText).toHaveBeenCalledWith('org_1', 'Pays invoices from AT611904300234573201.')
    expect(item.content).toBe('Pays invoices from [IBAN].')
    expect(item.pinned).toBe(true)
    expect(findPersonalMemoryByContentKey).toHaveBeenCalledWith(OWNER, 'pays invoices from iban')
  })
})

describe('a personal note is told apart by its letters in any script', () => {
  it.each([
    ['Привет', 'привет'],
    ['Здравствуйте, отвечайте кратко', 'здравствуйте отвечайте кратко'],
    ['ÄÖÜ', 'äöü'],
    ['Ｆｌｕｃｈｔｗｅｇ ２', 'fluchtweg 2'],
  ])('looks up and stores %s under its own key', async (content, key) => {
    vi.mocked(insertPersonalMemory).mockImplementation(async (values) => note(values as Partial<PersonalMemoryItem>))

    const result = await createPersonalMemoryItem(OWNER, { kind: 'preference', content, provenanceType: 'user' })

    expect(findPersonalMemoryByContentKey).toHaveBeenCalledWith(OWNER, key)
    expect(insertPersonalMemory).toHaveBeenCalledWith(expect.objectContaining({ content, contentKey: key }))
    expect(result.created).toBe(true)
  })

  it('refuses a note with no letter and no digit (400) before anything is read or written', async () => {
    const refused = createPersonalMemoryItem(OWNER, { kind: 'preference', content: '!!! — ???', provenanceType: 'user' })

    await expect(refused).rejects.toBeInstanceOf(BadRequestError)
    await expect(refused).rejects.toThrow('A personal note needs at least one letter or digit.')
    expect(findPersonalMemoryByContentKey).not.toHaveBeenCalled()
    expect(insertPersonalMemory).not.toHaveBeenCalled()
  })

  it('refuses such a text in an edit too', async () => {
    await expect(editPersonalMemoryItem(OWNER, 'note-1', { content: '…' })).rejects.toBeInstanceOf(BadRequestError)
    expect(updatePersonalMemory).not.toHaveBeenCalled()
  })
})

describe('a personal note never holds a secret', () => {
  it.each([
    ['a password with no trigger word', 'Projektserver-Zugang: Tulpe#4471!', 'a password or access code'],
    ['an API key', 'My key is sk-live-9f3a7c21d8e44b0aa1', 'an API key or access token'],
    ['an IBAN in groups the screening left', 'Konto AT61 1904 3002 3457 3201', 'a bank account number (IBAN)'],
  ])('refuses %s, on create and on edit, without repeating it', async (_what, content, named) => {
    const create = createPersonalMemoryItem(OWNER, { kind: 'profile', content, provenanceType: 'user' })
    await expect(create).rejects.toBeInstanceOf(BadRequestError)
    await expect(create).rejects.toThrow(`A memory note cannot hold ${named}.`)
    await expect(editPersonalMemoryItem(OWNER, 'note-1', { content })).rejects.toThrow(named)
    expect(insertPersonalMemory).not.toHaveBeenCalled()
    expect(updatePersonalMemory).not.toHaveBeenCalled()
  })

  it('keeps the person’s own phone number: personal data is what this shelf is for', async () => {
    vi.mocked(insertPersonalMemory).mockImplementation(async (values) => note(values as Partial<PersonalMemoryItem>))

    const { created } = await createPersonalMemoryItem(OWNER, {
      kind: 'profile',
      content: 'Reachable on +43 664 1234567 before noon.',
      provenanceType: 'user',
    })

    expect(created).toBe(true)
  })
})

describe('editPersonalMemoryItem', () => {
  it('changes the named fields, masking a new text and leaving a patch without text alone', async () => {
    vi.mocked(updatePersonalMemory).mockImplementation(async (_owner, _id, patch) => note(patch))

    const edited = await editPersonalMemoryItem(OWNER, 'note-1', { content: 'IBAN AT611904300234573201', pinned: true })
    expect(updatePersonalMemory).toHaveBeenCalledWith(OWNER, 'note-1', {
      content: 'IBAN [IBAN]',
      contentKey: 'iban iban',
      pinned: true,
    })
    expect(edited?.content).toBe('IBAN [IBAN]')

    vi.mocked(maskChatText).mockClear()
    await editPersonalMemoryItem(OWNER, 'note-1', { pinned: false })
    expect(maskChatText).not.toHaveBeenCalled()
    expect(updatePersonalMemory).toHaveBeenLastCalledWith(OWNER, 'note-1', { pinned: false })
  })

  it('is a 409 when another note of the person already says the new text', async () => {
    vi.mocked(updatePersonalMemory).mockRejectedValue(uniqueViolation())

    const refused = editPersonalMemoryItem(OWNER, 'note-1', { content: 'Answers in short paragraphs.' })

    await expect(refused).rejects.toBeInstanceOf(ConflictError)
    await expect(refused).rejects.toMatchObject({ status: 409, code: 'CONFLICT' })
  })

  it('answers null for a note the owner does not hold, and rethrows any other failure', async () => {
    vi.mocked(updatePersonalMemory).mockResolvedValueOnce(null)
    expect(await editPersonalMemoryItem(OWNER, 'note-of-somebody-else', { pinned: true })).toBeNull()

    const down = new Error('connection refused')
    vi.mocked(updatePersonalMemory).mockRejectedValueOnce(down)
    await expect(editPersonalMemoryItem(OWNER, 'note-1', { pinned: true })).rejects.toBe(down)
  })
})

describe('clearPersonalMemory', () => {
  it('removes every note of the owner handed in, in one statement, and answers how many went', async () => {
    vi.mocked(deleteAllPersonalMemory).mockResolvedValue(7)

    expect(await clearPersonalMemory(OWNER)).toBe(7)
    expect(deleteAllPersonalMemory).toHaveBeenCalledTimes(1)
    expect(deleteAllPersonalMemory).toHaveBeenCalledWith(OWNER)
    expect(deletePersonalMemory).not.toHaveBeenCalled()
  })

  it('answers 0 for a person who holds no note', async () => {
    vi.mocked(deleteAllPersonalMemory).mockResolvedValue(0)
    expect(await clearPersonalMemory(OWNER)).toBe(0)
  })
})

describe('forgetPersonalMemoryItem', () => {
  it('removes the agent’s note the quote names, matched with case and punctuation folded', async () => {
    vi.mocked(findPersonalMemoryByContentKey).mockResolvedValue(note({ id: 'note-1' }))
    vi.mocked(deletePersonalMemory).mockResolvedValue(true)

    expect(await forgetPersonalMemoryItem(OWNER, '  answers in SHORT paragraphs ')).toEqual({ removedId: 'note-1', refused: null })
    expect(findPersonalMemoryByContentKey).toHaveBeenCalledWith(OWNER, 'answers in short paragraphs')
    expect(deletePersonalMemory).toHaveBeenCalledWith(OWNER, 'note-1')
  })

  it('removes nothing and says not_found when no note says that, or the quote has no letter', async () => {
    expect(await forgetPersonalMemoryItem(OWNER, 'Mit „Lord“ ansprechen.')).toEqual({ removedId: null, refused: 'not_found' })
    expect(await forgetPersonalMemoryItem(OWNER, '…')).toEqual({ removedId: null, refused: 'not_found' })
    expect(deletePersonalMemory).not.toHaveBeenCalled()
  })

  it.each([
    ['the person wrote', { provenanceType: 'user' as const }],
    ['is pinned', { pinned: true }],
  ])('refuses a note the person %s as curated: theirs to remove in the panel', async (_name, overrides) => {
    vi.mocked(findPersonalMemoryByContentKey).mockResolvedValue(note(overrides))

    expect(await forgetPersonalMemoryItem(OWNER, 'Answers in short paragraphs.')).toEqual({ removedId: null, refused: 'curated' })
    expect(deletePersonalMemory).not.toHaveBeenCalled()
  })
})

describe('listPersonalMemory and removePersonalMemoryItem', () => {
  it('reads and removes for the owner handed in, never a wider scope', async () => {
    vi.mocked(selectPersonalMemory).mockResolvedValue([note()])
    vi.mocked(deletePersonalMemory).mockResolvedValue(true)

    expect(await listPersonalMemory(OWNER)).toEqual({ items: [note()], nextCursor: null })
    expect(selectPersonalMemory).toHaveBeenCalledWith(OWNER, 51, 0, {})
    expect(await removePersonalMemoryItem(OWNER, 'note-1')).toBe(true)
    expect(deletePersonalMemory).toHaveBeenCalledWith(OWNER, 'note-1')
  })

  it('answers one page and the cursor of the next when a row past the page came back', async () => {
    vi.mocked(selectPersonalMemory).mockResolvedValue([note({ id: 'a' }), note({ id: 'b' }), note({ id: 'c' })])

    const page = await listPersonalMemory(OWNER, { limit: 2, offset: 4 })

    expect(selectPersonalMemory).toHaveBeenCalledWith(OWNER, 3, 4, {})
    expect(page.items.map((item) => item.id)).toEqual(['a', 'b'])
    expect(page.nextCursor).toBe('6')
  })

  it('narrows the list to one conversation’s notes, still for the owner handed in', async () => {
    vi.mocked(selectPersonalMemory).mockResolvedValue([note({ sourceConversationId: 's_1' })])

    await listPersonalMemory(OWNER, { limit: 200, offset: 0 }, { sourceConversationId: 's_1' })

    expect(selectPersonalMemory).toHaveBeenCalledWith(OWNER, 201, 0, { sourceConversationId: 's_1' })
  })
})

describe('buildPersonalMemoryDigest', () => {
  it('is null when the person holds no note', async () => {
    vi.mocked(selectPersonalMemory).mockResolvedValue([])
    expect(await buildPersonalMemoryDigest(OWNER)).toBeNull()
  })

  it('renders one quoted line per note under the header, in the repository’s order, pinned marked', async () => {
    vi.mocked(selectPersonalMemory).mockResolvedValue([
      note({ kind: 'profile', content: 'Leads the fire-safety reviews.', pinned: true }),
      note({ content: 'Says "kurz" when an answer runs long.' }),
    ])

    const digest = await buildPersonalMemoryDigest(OWNER)

    expect(digest).toBe(
      [
        PERSONAL_MEMORY_DIGEST_HEADER,
        '- [pinned | profile] "Leads the fire-safety reviews."',
        '- [preference] "Says \\"kurz\\" when an answer runs long."',
      ].join('\n')
    )
    expect(PERSONAL_MEMORY_DIGEST_HEADER).toBe('PERSONAL_MEMORY v1')
    // One more than fits, so a cut can be counted.
    expect(selectPersonalMemory).toHaveBeenCalledWith(OWNER, PERSONAL_DIGEST_MAX_ITEMS + 1)
  })

  it('gives a turn at most 20 notes and says in English how many it left out', async () => {
    const rows = Array.from({ length: PERSONAL_DIGEST_MAX_ITEMS + 1 }, (_, index) => note({ content: `Note ${index}.` }))
    vi.mocked(selectPersonalMemory).mockResolvedValue(rows)

    const digest = (await buildPersonalMemoryDigest(OWNER)) as string
    const lines = digest.split('\n')

    expect(lines.filter((line) => line.startsWith('- ['))).toHaveLength(20)
    expect(lines.at(-1)).toBe('(+1 more personal notes, not shown.)')
    expect(digest).not.toContain('Note 20.')
  })

  it('stays within 1,500 characters, footer included, and counts the notes the budget cut', async () => {
    const rows = Array.from({ length: 8 }, (_, index) => note({ content: `${index} ${'x'.repeat(300)}` }))
    vi.mocked(selectPersonalMemory).mockResolvedValue(rows)

    const digest = (await buildPersonalMemoryDigest(OWNER)) as string
    const kept = digest.split('\n').filter((line) => line.startsWith('- [')).length

    expect(PERSONAL_DIGEST_MAX_CHARS).toBe(1500)
    expect(digest.length).toBeLessThanOrEqual(PERSONAL_DIGEST_MAX_CHARS)
    expect(kept).toBeGreaterThan(0)
    expect(kept).toBeLessThan(8)
    expect(digest.endsWith(`(+${8 - kept} more personal notes, not shown.)`)).toBe(true)
  })

  it('has no footer when every note fits, and still says a note exists when not even one fits', async () => {
    vi.mocked(selectPersonalMemory).mockResolvedValue([note()])
    expect(await buildPersonalMemoryDigest(OWNER)).not.toContain('more personal notes')

    vi.mocked(selectPersonalMemory).mockResolvedValue([note({ content: 'y'.repeat(2000) }), note({ content: 'Short.' })])
    expect(await buildPersonalMemoryDigest(OWNER)).toBe('PERSONAL_MEMORY v1\n(+2 more personal notes, not shown.)')
  })
})
