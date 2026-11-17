/**
 * @vitest-environment node
 *
 * A temporary conversation over the wire (ADR-0180 rule 2): the create carries
 * the flag only when it is set, and the switch is one PATCH whose refusal
 * carries its status, so the composer can tell "not yours" from "try again".
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

describe('conversationsClient and temporary', () => {
  it('starts a conversation as temporary when asked', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's_1', temporary: true }))

    const row = await conversationsClient.create('s_1', null, 'p-1', null, true)

    expect(sentBody()).toMatchObject({ id: 's_1', projectId: 'p-1', temporary: true })
    expect(row.temporary).toBe(true)
  })

  it('leaves the flag out of an ordinary create', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's_1', temporary: false }))

    await conversationsClient.create('s_1', null, 'p-1')

    expect(sentBody()).not.toHaveProperty('temporary')
  })

  it('switches an existing conversation with one PATCH', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ id: 's 1', temporary: false }))

    await conversationsClient.setTemporary('s 1', false)

    expect(fetchMock).toHaveBeenCalledWith('/api/conversations/s%201', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ temporary: false }),
    })
  })

  it('carries the status of a refusal', async () => {
    fetchMock.mockResolvedValueOnce(new Response('no', { status: 404 }))

    await expect(conversationsClient.setTemporary('s_1', true)).rejects.toMatchObject({ status: 404 })
  })
})
