/**
 * @vitest-environment node
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/backend-proxy', () => ({ getBackendUrl: () => 'http://backend:8000' }))

import { discardConversationDrafts } from './working-directory'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('INTERNAL_API_TOKEN', 'test-token')
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discardConversationDrafts', () => {
  it('DELETEs the conversation’s drafts with the internal service token', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204 })

    await expect(discardConversationDrafts('s_conv 1')).resolves.toBe(true)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://backend:8000/v1/drafts/s_conv%201')
    expect(init.method).toBe('DELETE')
    expect(init.headers['x-internal-token']).toBe('test-token')
    expect(init.signal).toBeDefined()
  })

  it('reads a 404 as success, because most conversations never wrote a draft', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404 })
    await expect(discardConversationDrafts('s_conv_1')).resolves.toBe(true)
  })

  it('reports a refusal without throwing', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 })
    await expect(discardConversationDrafts('s_conv_1')).resolves.toBe(false)
  })

  it('never throws when the service is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(discardConversationDrafts('s_conv_1')).resolves.toBe(false)
  })

  it('does not call an unauthenticated DELETE when the token is unconfigured', async () => {
    vi.stubEnv('INTERNAL_API_TOKEN', undefined)
    await expect(discardConversationDrafts('s_conv_1')).resolves.toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
