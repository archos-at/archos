/**
 * @vitest-environment node
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRedisClient } from './connect.js'

const URL = process.env.REALTIME_REDIS_URL

const until = async (check: () => boolean, ms = 3_000) => {
  const end = Date.now() + ms
  while (!check() && Date.now() < end) await new Promise((resolve) => setTimeout(resolve, 20))
}

describe('createRedisClient', () => {
  const clients: { disconnect(): void }[] = []
  afterEach(() => {
    for (const client of clients.splice(0)) client.disconnect()
    vi.restoreAllMocks()
  })

  it('warns once for an outage however many reconnect attempts fail', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    let errors = 0
    const client = createRedisClient('redis://127.0.0.1:1', 'test', { commandTimeout: 200 })
    clients.push(client)
    client.on('error', () => {
      errors += 1
    })

    await until(() => errors >= 3)

    expect(errors).toBeGreaterThanOrEqual(3)
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]?.[0])).toContain('[test] redis unreachable')
  })

  it.skipIf(!URL)('queues a cold first command, then fails fast once warm and disconnected', async () => {
    const client = createRedisClient(URL!, 'test', { commandTimeout: 1000 })
    clients.push(client)

    await expect(client.ping()).resolves.toBe('PONG')
    expect(client.options.enableOfflineQueue).toBe(false)

    const queued = createRedisClient(URL!, 'test', { commandTimeout: 1000, queueWhileDown: true })
    clients.push(queued)
    await expect(queued.ping()).resolves.toBe('PONG')
    expect(queued.options.enableOfflineQueue).toBe(true)
  })
})
