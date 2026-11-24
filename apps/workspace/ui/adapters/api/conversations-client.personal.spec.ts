/**
 * @vitest-environment node
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { conversationsClient } from './conversations-client'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const sentBody = (): Record<string, unknown> => JSON.parse(fetchMock.mock.calls[0][1].body as string)

describe('conversationsClient and Persönlich (ADR-0193 amendment)', () => {
  it('starts a chat without a project as a Persönlich chat', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's_1' }))

    await conversationsClient.create('s_1', null, null)

    expect(sentBody()).toMatchObject({ id: 's_1', projectId: null, personal: true })
  })

  it('sends no personal mark for a project chat', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's_1' }))

    await conversationsClient.create('s_1', null, 'p-1')

    expect(sentBody()).not.toHaveProperty('personal')
  })
})
