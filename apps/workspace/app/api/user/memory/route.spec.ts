/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'member',
    permissions: [],
  }),
}))
vi.mock('@/lib/personal-memory/service', () => ({
  listPersonalMemory: vi.fn(),
  createPersonalMemoryItem: vi.fn(),
}))

import { SessionRequiredError } from '@/lib/api/errors'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { createPersonalMemoryItem, listPersonalMemory } from '@/lib/personal-memory/service'
import { GET, POST } from './route'

const OWNER = { organizationId: 'org_1', userId: 'user_1' }
const NOTE = { id: '11111111-1111-4111-8111-111111111111', kind: 'preference', content: 'Answers in short paragraphs.', pinned: false }
const context = { params: Promise.resolve({}) }

function post(body: unknown) {
  return POST(
    new Request('https://grid.test/api/user/memory', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/user/memory', () => {
  it('lists one page of the caller’s own notes, keyed to the session and nothing else', async () => {
    vi.mocked(listPersonalMemory).mockResolvedValue({ items: [NOTE], nextCursor: null } as never)

    const response = await GET(new Request('https://grid.test/api/user/memory?userId=user_2'), context)

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ items: [NOTE], nextCursor: null })
    expect(listPersonalMemory).toHaveBeenCalledWith(OWNER, { limit: 50, offset: 0 })
  })

  it('pages by limit and the previous nextCursor, and refuses a cursor it did not hand out', async () => {
    vi.mocked(listPersonalMemory).mockResolvedValue({ items: [NOTE], nextCursor: '20' } as never)

    const response = await GET(new Request('https://grid.test/api/user/memory?limit=10&cursor=10'), context)

    expect((await response.json()).nextCursor).toBe('20')
    expect(listPersonalMemory).toHaveBeenCalledWith(OWNER, { limit: 10, offset: 10 })
    expect((await GET(new Request('https://grid.test/api/user/memory?cursor=abc'), context)).status).toBe(400)
    expect((await GET(new Request('https://grid.test/api/user/memory?limit=201'), context)).status).toBe(400)
  })

  it('is refused without a session (the route wrapper answers a missing session as 403)', async () => {
    vi.mocked(requireAuthorizedSession).mockRejectedValueOnce(new SessionRequiredError())

    const response = await GET(new Request('https://grid.test/api/user/memory'), context)

    expect(response.status).toBe(403)
    expect(listPersonalMemory).not.toHaveBeenCalled()
  })
})

describe('POST /api/user/memory', () => {
  it('keeps a note for the session’s person as the person’s own (provenance user), 201 with the item', async () => {
    vi.mocked(createPersonalMemoryItem).mockResolvedValue({ item: NOTE, created: true } as never)

    const response = await post({ kind: 'preference', content: '  Answers in short paragraphs.  ', pinned: true })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ item: NOTE })
    expect(createPersonalMemoryItem).toHaveBeenCalledWith(OWNER, {
      kind: 'preference',
      content: 'Answers in short paragraphs.',
      pinned: true,
      provenanceType: 'user',
    })
  })

  it('ignores an owner or a provenance the body tries to name', async () => {
    vi.mocked(createPersonalMemoryItem).mockResolvedValue({ item: NOTE, created: true } as never)

    await post({ kind: 'profile', content: 'x', userId: 'user_2', organizationId: 'org_2', provenanceType: 'agent' })

    expect(createPersonalMemoryItem).toHaveBeenCalledWith(OWNER, { kind: 'profile', content: 'x', provenanceType: 'user' })
  })

  it.each([
    ['an unknown kind', { kind: 'decision', content: 'x' }],
    ['an empty text', { kind: 'preference', content: '   ' }],
    ['a text past 2,000 characters', { kind: 'preference', content: 'x'.repeat(2001) }],
    ['no kind', { content: 'x' }],
  ])('refuses %s with a 400 and keeps nothing', async (_name, body) => {
    const response = await post(body)

    expect(response.status).toBe(400)
    expect(createPersonalMemoryItem).not.toHaveBeenCalled()
  })
})
