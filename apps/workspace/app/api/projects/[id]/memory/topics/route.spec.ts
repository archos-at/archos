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
  renameProjectMemoryTopic: vi.fn(async () => ({ moved: 0 })),
}))

import { BadRequestError, ForbiddenError, SessionRequiredError } from '@/lib/api/errors'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { renameProjectMemoryTopic } from '@/lib/projects/service'
import { PATCH } from './route'

const PROJECT = '22222222-2222-4222-8222-222222222222'
const context = { params: Promise.resolve({ id: PROJECT }) }

function patch(body: unknown) {
  return PATCH(
    new Request(`https://grid.test/api/projects/${PROJECT}/memory/topics`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(renameProjectMemoryTopic).mockResolvedValue({ moved: 0 })
})

describe('PATCH /api/projects/[id]/memory/topics', () => {
  it('hands the session and the project to the shelf rename, and answers its count', async () => {
    vi.mocked(renameProjectMemoryTopic).mockResolvedValue({ moved: 2 })

    const response = await patch({ from: 'Brandschutz', to: 'Fassade' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ moved: 2 })
    expect(renameProjectMemoryTopic).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', organizationId: 'org_1' }),
      PROJECT,
      { from: 'Brandschutz', to: 'Fassade' }
    )
  })

  it('passes null through: to ungroups the topic’s notes, from null renames the notes with no topic', async () => {
    await patch({ from: 'Brandschutz', to: null })
    await patch({ from: null, to: 'Brandschutz' })

    expect(renameProjectMemoryTopic).toHaveBeenNthCalledWith(1, expect.anything(), PROJECT, {
      from: 'Brandschutz',
      to: null,
    })
    expect(renameProjectMemoryTopic).toHaveBeenNthCalledWith(2, expect.anything(), PROJECT, {
      from: null,
      to: 'Brandschutz',
    })
  })

  it('answers 400 on a blank from, before the service runs', async () => {
    const response = await patch({ from: '', to: 'Fassade' })

    expect(response.status).toBe(400)
    expect(renameProjectMemoryTopic).not.toHaveBeenCalled()
  })

  it('answers 400 on a to longer than the wire bound, before the service runs', async () => {
    const response = await patch({ from: 'Brandschutz', to: 'x'.repeat(201) })

    expect(response.status).toBe(400)
    expect(renameProjectMemoryTopic).not.toHaveBeenCalled()
  })

  it('answers 400 when the service refuses a to over the topic bound (40 characters)', async () => {
    vi.mocked(renameProjectMemoryTopic).mockRejectedValue(
      new BadRequestError('A topic is at most 40 characters.')
    )

    const response = await patch({ from: 'Brandschutz', to: 'x'.repeat(41) })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'A topic is at most 40 characters.' })
  })

  it('answers the service’s refusal as is: the shelf enforces project:memory:write, the route adds no gate of its own', async () => {
    vi.mocked(renameProjectMemoryTopic).mockRejectedValue(new ForbiddenError())

    const response = await patch({ from: 'Brandschutz', to: 'Fassade' })

    expect(response.status).toBe(403)
    expect(renameProjectMemoryTopic).toHaveBeenCalledTimes(1)
  })

  it('is refused without a session, before the service runs', async () => {
    vi.mocked(requireAuthorizedSession).mockRejectedValueOnce(new SessionRequiredError())

    const response = await patch({ from: 'Brandschutz', to: 'Fassade' })

    expect(response.status).toBe(403)
    expect(renameProjectMemoryTopic).not.toHaveBeenCalled()
  })
})
