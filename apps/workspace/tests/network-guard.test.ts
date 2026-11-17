import net from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NETWORK_REFUSED_HEADER } from '../config/vitest/network-guard'

describe('the network guard', () => {
  afterEach(() => vi.restoreAllMocks())

  it('answers an unmocked request without opening a socket', async () => {
    const connect = vi.spyOn(net.Socket.prototype, 'connect')

    const response = await fetch('http://localhost:3000/api/conversations/s_unmocked')

    expect(response.status).toBe(503)
    expect(response.headers.get(NETWORK_REFUSED_HEADER)).toBe('refused')
    expect(connect).not.toHaveBeenCalled()
  })

  it('refuses a request to any host, not just the app origin', async () => {
    const response = await fetch('https://example.invalid/image.png')

    expect(response.headers.get(NETWORK_REFUSED_HEADER)).toBe('refused')
  })
})
