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
vi.mock('@/lib/projects/service', () => ({
  editProjectMemoryItem: vi.fn(),
  removeProjectMemoryItem: vi.fn(),
}))

import { ConflictError } from '@/lib/api/errors'
import { editProjectMemoryItem } from '@/lib/projects/service'
import { PATCH } from './route'

const PROJECT = '22222222-2222-4222-8222-222222222222'
const ITEM = '11111111-1111-4111-8111-111111111111'

function patch(body: unknown) {
  return PATCH(
    new Request(`https://grid.test/api/projects/${PROJECT}/memory/${ITEM}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: PROJECT, itemId: ITEM }) }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/projects/[id]/memory/[itemId]', () => {
  it('answers 409 when another note of the project already says the edited text', async () => {
    vi.mocked(editProjectMemoryItem).mockRejectedValue(new ConflictError('Another note already says this'))

    const response = await patch({ content: 'Die Attika ist 1,20 m hoch.' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'Another note already says this', code: 'CONFLICT' })
  })

  it('answers 409 invalid-transition for a move the lifecycle does not allow', async () => {
    vi.mocked(editProjectMemoryItem).mockRejectedValue(
      new ConflictError('A dismissed note cannot become superseded', {
        reason: 'invalid-transition',
        from: 'dismissed',
        to: 'superseded',
        allowed: ['active'],
      })
    )

    const response = await patch({ status: 'superseded' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ details: { reason: 'invalid-transition', allowed: ['active'] } })
  })
})
