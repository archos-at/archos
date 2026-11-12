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
vi.mock('@/lib/projects/office-memory-topics', () => ({
  officeTopicsOf: vi.fn(async (): Promise<MemoryTopicCount[]> => []),
  withOfficeTopic: vi.fn(async (_organizationId: string, input: unknown) => input),
}))

import type { ProjectMemoryItem } from '@/lib/db/schema/project-memory'
import type { MemoryTopicCount } from '@/lib/memory-topics/topic'
import { listOrganizationMemory } from '@/lib/projects/memory-service'
import { createOrganizationMemoryItem } from '@/lib/projects/service'
import { officeTopicsOf, withOfficeTopic } from '@/lib/projects/office-memory-topics'
import { GET, POST } from './route'

const context = { params: Promise.resolve({}) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listOrganizationMemory).mockResolvedValue([])
  vi.mocked(officeTopicsOf).mockResolvedValue([])
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

  it('answers the office topics over the whole shelf, not the page', async () => {
    vi.mocked(officeTopicsOf).mockResolvedValue([{ name: 'Brandschutz', count: 3 }])

    const response = await GET(new Request('https://grid.test/api/organization/memory?limit=1'), context)

    expect(await response.json()).toMatchObject({ topics: [{ name: 'Brandschutz', count: 3 }] })
    expect(officeTopicsOf).toHaveBeenCalledWith('org_1')
  })
})

describe('POST /api/organization/memory', () => {
  it('resolves a named topic against the office shelf before the write', async () => {
    vi.mocked(createOrganizationMemoryItem).mockResolvedValue({ id: 'mem_org' } as Partial<ProjectMemoryItem> as ProjectMemoryItem)

    const response = await POST(
      new Request('https://grid.test/api/organization/memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'decision', content: 'Die Attika ist 1,20 m hoch.', topic: 'brandschutz' }),
      }),
      context
    )

    expect(response.status).toBe(201)
    expect(withOfficeTopic).toHaveBeenCalledWith('org_1', expect.objectContaining({ topic: 'brandschutz' }))
    expect(createOrganizationMemoryItem).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ topic: 'brandschutz' })
    )
  })
})
