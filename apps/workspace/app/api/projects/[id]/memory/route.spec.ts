/**
 * @vitest-environment node
 */
/**
 * A memory item leaves the server without its embedding. The vector is ~6 KB
 * per item: one project's list was 3.5 MB over MCP, and a write echoed it back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeMemoryItem } from '@/test-utils/db-fixtures'

vi.mock('@/lib/auth/require-auth', () => ({
  requireAuthorizedSession: vi.fn().mockResolvedValue({
    userId: 'user_1',
    organizationId: 'org_1',
    role: 'member',
    permissions: [],
  }),
}))

const service = vi.hoisted(() => ({
  getProjectMemoryShelf: vi.fn(async () => ({
    items: [] as unknown[],
    nextCursor: null as string | null,
    topics: [] as { name: string; count: number }[],
  })),
  addProjectMemoryItem: vi.fn(),
}))
vi.mock('@/lib/projects/service', () => service)
const access = vi.hoisted(() => ({ canWriteProjectMemory: vi.fn() }))
vi.mock('@/lib/projects/settings-access', () => access)

import { GET, POST } from './route'

const embedded = () =>
  makeMemoryItem({
    embedding: Array.from({ length: 1536 }, () => 0.1),
    embeddingModel: 'model-v1',
    embeddedAt: new Date('2026-01-01T00:00:00Z'),
  })

const ctx = { params: Promise.resolve({ id: 'proj-1' }) }

describe('project memory routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    access.canWriteProjectMemory.mockResolvedValue(false)
    service.getProjectMemoryShelf.mockResolvedValue({ items: [embedded()], nextCursor: null, topics: [] })
  })

  it('says with the list whether the caller may edit and remove the notes', async () => {
    const address = 'https://grid.example/api/projects/proj-1/memory?conversationId=s_1&limit=200'

    expect((await (await GET(new Request(address), ctx)).json()).canWrite).toBe(false)
    access.canWriteProjectMemory.mockResolvedValue(true)
    expect((await (await GET(new Request(address), ctx)).json()).canWrite).toBe(true)

    expect(access.canWriteProjectMemory).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user_1' }), 'proj-1')
    expect(service.getProjectMemoryShelf).toHaveBeenCalledWith(
      expect.anything(),
      'proj-1',
      expect.objectContaining({ sourceConversationId: 's_1', page: { limit: 200, offset: 0 } })
    )
  })

  it('answers the page and the topics from one shelf read, so both count the same notes', async () => {
    service.getProjectMemoryShelf.mockResolvedValue({
      items: [embedded()],
      nextCursor: null,
      topics: [{ name: 'Brandschutz', count: 1 }],
    })

    const body = await (await GET(new Request('https://grid.example/api/projects/proj-1/memory'), ctx)).json()

    expect(service.getProjectMemoryShelf).toHaveBeenCalledTimes(1)
    expect(body.topics).toEqual([{ name: 'Brandschutz', count: 1 }])
    expect(body.items).toHaveLength(1)
  })

  it('passes the topic filter to the shelf read, which filters after visibility', async () => {
    await GET(new Request('https://grid.example/api/projects/proj-1/memory?topic=Brandschutz'), ctx)

    expect(service.getProjectMemoryShelf).toHaveBeenCalledWith(
      expect.anything(),
      'proj-1',
      expect.objectContaining({ topic: 'Brandschutz' })
    )
  })

  it('lists items without embedding fields', async () => {
    const res = await GET(new Request('https://grid.example/api/projects/proj-1/memory'), ctx)
    const text = await res.text()
    const body = JSON.parse(text)
    expect(body.items).toHaveLength(1)
    expect(body.items[0]).toMatchObject({ id: 'item-1', content: 'The roof load is 2 kN/m2.' })
    expect(body.items[0]).not.toHaveProperty('embedding')
    expect(body.items[0]).not.toHaveProperty('embeddingModel')
    expect(body.items[0]).not.toHaveProperty('embeddedAt')
    expect(text.length).toBeLessThan(2000)
  })

  it('does not echo the embedding after a write', async () => {
    service.addProjectMemoryItem.mockResolvedValue(embedded())
    const res = await POST(
      new Request('https://grid.example/api/projects/proj-1/memory', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'derived_fact', content: 'x' }),
      }),
      ctx
    )
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.item).not.toHaveProperty('embedding')
    expect(body.item.id).toBe('item-1')
  })
})
