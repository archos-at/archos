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
  renamePersonalMemoryTopic: vi.fn(async () => ({ moved: 0 })),
  removePersonalMemoryTopic: vi.fn(async () => ({ removed: 0 })),
}))

import { SessionRequiredError } from '@/lib/api/errors'
import { requireAuthorizedSession } from '@/lib/auth/require-auth'
import { removePersonalMemoryTopic, renamePersonalMemoryTopic } from '@/lib/personal-memory/service'
import { DELETE, PATCH } from './route'

const OWNER = { organizationId: 'org_1', userId: 'user_1' }
const context = { params: Promise.resolve({}) }

function send(method: 'PATCH' | 'DELETE', body: unknown) {
  return (method === 'PATCH' ? PATCH : DELETE)(
    new Request('https://grid.test/api/user/memory/topics', {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(renamePersonalMemoryTopic).mockResolvedValue({ moved: 0 })
  vi.mocked(removePersonalMemoryTopic).mockResolvedValue({ removed: 0 })
})

describe('PATCH /api/user/memory/topics', () => {
  it('moves every note of the session’s person on the topic and answers the count', async () => {
    vi.mocked(renamePersonalMemoryTopic).mockResolvedValue({ moved: 3 })

    const response = await send('PATCH', { from: 'Brandschutz', to: 'Fassade' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ moved: 3 })
    expect(renamePersonalMemoryTopic).toHaveBeenCalledWith(OWNER, {
      from: 'Brandschutz',
      to: 'Fassade',
    })
  })

  it('ungroups with to null, and ignores an owner the body names: the notes are the session’s', async () => {
    await send('PATCH', {
      from: 'Brandschutz',
      to: null,
      userId: 'user_2',
      organizationId: 'org_2',
    })

    expect(renamePersonalMemoryTopic).toHaveBeenCalledWith(OWNER, { from: 'Brandschutz', to: null })
  })

  it('answers 400 on a blank from, before the service runs', async () => {
    const response = await send('PATCH', { from: '', to: 'Fassade' })

    expect(response.status).toBe(400)
    expect(renamePersonalMemoryTopic).not.toHaveBeenCalled()
  })

  it('answers 400 on a to longer than the wire bound, before the service runs', async () => {
    const response = await send('PATCH', { from: 'Brandschutz', to: 'x'.repeat(201) })

    expect(response.status).toBe(400)
    expect(renamePersonalMemoryTopic).not.toHaveBeenCalled()
  })

  it('is refused without a session, before the service runs', async () => {
    vi.mocked(requireAuthorizedSession).mockRejectedValueOnce(new SessionRequiredError())

    const response = await send('PATCH', { from: 'Brandschutz', to: 'Fassade' })

    expect(response.status).toBe(403)
    expect(renamePersonalMemoryTopic).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/user/memory/topics', () => {
  it('removes every note of the session’s person on the named topic, and answers the count', async () => {
    vi.mocked(removePersonalMemoryTopic).mockResolvedValue({ removed: 2 })

    const response = await send('DELETE', { name: 'Bauherr' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ removed: 2 })
    expect(removePersonalMemoryTopic).toHaveBeenCalledWith(OWNER, 'Bauherr')
  })

  it('answers 400 when the name is blank or missing, before the service runs', async () => {
    expect((await send('DELETE', { name: '' })).status).toBe(400)
    expect((await send('DELETE', {})).status).toBe(400)
    expect(removePersonalMemoryTopic).not.toHaveBeenCalled()
  })

  it('is refused without a session, before the service runs', async () => {
    vi.mocked(requireAuthorizedSession).mockRejectedValueOnce(new SessionRequiredError())

    const response = await send('DELETE', { name: 'Bauherr' })

    expect(response.status).toBe(403)
    expect(removePersonalMemoryTopic).not.toHaveBeenCalled()
  })
})
