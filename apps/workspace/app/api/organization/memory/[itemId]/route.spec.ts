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
vi.mock('@/lib/projects/memory-service', () => ({
  updateProjectMemoryItem: vi.fn(),
  deleteProjectMemoryItem: vi.fn(),
}))

import { BadRequestError, ConflictError } from '@/lib/api/errors'
import { updateProjectMemoryItem } from '@/lib/projects/memory-service'
import { PATCH } from './route'

const ITEM = '11111111-1111-4111-8111-111111111111'

function patch(body: unknown) {
  return PATCH(
    new Request(`https://grid.test/api/organization/memory/${ITEM}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ itemId: ITEM }) }
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PATCH /api/organization/memory/[itemId]', () => {
  it('answers 409 when another office note already says the edited text', async () => {
    vi.mocked(updateProjectMemoryItem).mockRejectedValue(new ConflictError('Another note already says this'))

    const response = await patch({ content: 'Die Attika ist 1,20 m hoch.' })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: 'Another note already says this', code: 'CONFLICT' })
    expect(updateProjectMemoryItem).toHaveBeenCalledWith({ organizationId: 'org_1' }, ITEM, {
      content: 'Die Attika ist 1,20 m hoch.',
    })
  })

  it('answers 400 for a secret in the edited text', async () => {
    vi.mocked(updateProjectMemoryItem).mockRejectedValue(
      new BadRequestError('A memory note cannot hold a password or access code.')
    )

    expect((await patch({ content: 'WLAN-Passwort: Baustelle#7' })).status).toBe(400)
  })

  it('refuses a status no note can be in', async () => {
    expect((await patch({ status: 'proposed' })).status).toBe(400)
    expect(updateProjectMemoryItem).not.toHaveBeenCalled()
  })
})
