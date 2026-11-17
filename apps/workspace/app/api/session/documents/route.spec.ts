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

vi.mock('@/lib/session-documents/service', () => ({
  listSessionDocuments: vi.fn().mockResolvedValue({ documents: [], collectionName: 's_x' }),
}))

import { listSessionDocuments } from '@/lib/session-documents/service'
import { GET } from './route'

const CONVERSATION_ID = 's_3f2504e0_4f89_11d3_9a0c_0305e82c3301'

const list = (conversationId: string) =>
  GET(
    new Request(
      `https://grid.example/api/session/documents?conversationId=${encodeURIComponent(conversationId)}`
    )
  )

describe('GET /api/session/documents', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts a conversation id of the shape the app actually mints', async () => {
    const response = await list(CONVERSATION_ID)

    expect(response.status).toBe(200)
    expect(listSessionDocuments).toHaveBeenCalledWith(expect.anything(), CONVERSATION_ID)
  })

  it.each([
    ['a bare word', 'nonsense'],
    ['a hyphenated UUID with no prefix', '3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['an id missing its `s_` prefix', '3f2504e0_4f89_11d3_9a0c_0305e82c3301'],
    ['a SQL-ish string', "s_1' OR '1'='1"],
    ['a collection name for another shelf', 'proj_3f2504e0-4f89-11d3-9a0c-0305e82c3301'],
    ['a path traversal', 's_../../etc/passwd'],
    ['a truncated id', 's_3f2504e0_4f89_11d3_9a0c_0305e82c33'],
  ])('rejects %s with 400 and never reaches the service', async (_label, id) => {
    const response = await list(id)

    expect(response.status).toBe(400)
    expect(listSessionDocuments).not.toHaveBeenCalled()
  })

  it('does not demand a UUID, which no conversation id is', async () => {
    const response = await list(CONVERSATION_ID)

    expect(response.status).toBe(200)
    expect(CONVERSATION_ID).not.toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    )
  })
})
