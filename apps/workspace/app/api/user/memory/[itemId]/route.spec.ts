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
  editPersonalMemoryItem: vi.fn(),
  removePersonalMemoryItem: vi.fn(),
}))

import { ConflictError } from '@/lib/api/errors'
import { editPersonalMemoryItem, removePersonalMemoryItem } from '@/lib/personal-memory/service'
import { DELETE, PATCH } from './route'

const OWNER = { organizationId: 'org_1', userId: 'user_1' }
const NOTE_ID = '11111111-1111-4111-8111-111111111111'
const NOTE = { id: NOTE_ID, kind: 'preference', content: 'Answers in short paragraphs.', pinned: true }

const contextFor = (itemId: string) => ({ params: Promise.resolve({ itemId }) })

function patch(itemId: string, body: unknown) {
  return PATCH(
    new Request(`https://grid.test/api/user/memory/${itemId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    contextFor(itemId)
  )
}

function remove(itemId: string) {
  return DELETE(new Request(`https://grid.test/api/user/memory/${itemId}`, { method: 'DELETE' }), contextFor(itemId))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/user/memory/[itemId]', () => {
  it('edits the caller’s own note and answers it', async () => {
    vi.mocked(editPersonalMemoryItem).mockResolvedValue(NOTE as never)

    const response = await patch(NOTE_ID, { pinned: true })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ item: NOTE })
    expect(editPersonalMemoryItem).toHaveBeenCalledWith(OWNER, NOTE_ID, { pinned: true })
  })

  it('is a 404 for a note the caller does not hold: somebody else’s is never shown to this query', async () => {
    vi.mocked(editPersonalMemoryItem).mockResolvedValue(null)

    expect((await patch(NOTE_ID, { pinned: true })).status).toBe(404)
  })

  it('is a 404 for an id that is no UUID, without asking the database', async () => {
    expect((await patch('not-a-uuid', { pinned: true })).status).toBe(404)
    expect(editPersonalMemoryItem).not.toHaveBeenCalled()
  })

  it('is a 409 when another note of the person already says the new text', async () => {
    vi.mocked(editPersonalMemoryItem).mockRejectedValue(new ConflictError('Another personal note already says this'))

    const response = await patch(NOTE_ID, { content: 'Answers in short paragraphs.' })

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('CONFLICT')
  })

  it('refuses an empty patch and an unknown kind with a 400', async () => {
    expect((await patch(NOTE_ID, {})).status).toBe(400)
    expect((await patch(NOTE_ID, { kind: 'decision' })).status).toBe(400)
    expect(editPersonalMemoryItem).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/user/memory/[itemId]', () => {
  it('removes the caller’s own note and answers 204', async () => {
    vi.mocked(removePersonalMemoryItem).mockResolvedValue(true)

    const response = await remove(NOTE_ID)

    expect(response.status).toBe(204)
    expect(removePersonalMemoryItem).toHaveBeenCalledWith(OWNER, NOTE_ID)
  })

  it('is a 404 for a note the caller does not hold, and for an id that is no UUID', async () => {
    vi.mocked(removePersonalMemoryItem).mockResolvedValue(false)

    expect((await remove(NOTE_ID)).status).toBe(404)
    expect((await remove('not-a-uuid')).status).toBe(404)
    expect(removePersonalMemoryItem).toHaveBeenCalledTimes(1)
  })
})
