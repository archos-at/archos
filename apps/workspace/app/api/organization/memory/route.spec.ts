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
vi.mock('@/lib/projects/memory-service', () => ({ listOrganizationMemory: vi.fn() }))
vi.mock('@/lib/projects/service', () => ({ createOrganizationMemoryItem: vi.fn() }))

import { listOrganizationMemory } from '@/lib/projects/memory-service'
import { GET } from './route'

const context = { params: Promise.resolve({}) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listOrganizationMemory).mockResolvedValue([])
})

describe('GET /api/organization/memory', () => {
  it('narrows to the notes written from one conversation: what an answer’s chip may offer to take back', async () => {
    const response = await GET(new Request('https://grid.test/api/organization/memory?conversationId=s_1&limit=200'), context)

    expect(response.status).toBe(200)
    expect(listOrganizationMemory).toHaveBeenCalledWith('org_1', {
      includeArchived: false,
      sourceConversationId: 's_1',
      page: { limit: 200, offset: 0 },
    })
  })

  it('lists the whole shelf without one', async () => {
    await GET(new Request('https://grid.test/api/organization/memory'), context)

    expect(listOrganizationMemory).toHaveBeenCalledWith('org_1', expect.objectContaining({ sourceConversationId: undefined }))
  })
})
