/**
 * @vitest-environment node
 */
/**
 * Three seams between the driver and its statechart that `turn-socket.spec.ts`
 * does not reach: a preparation that outlives a close, a socket that cannot be
 * constructed, and a caller's callback that throws inside a machine step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTurnSocket, type TurnSocketOptions, type WebSocketLike } from './turn-socket'

const setup = (extra: Partial<TurnSocketOptions> = {}) => {
  const sockets: WebSocketLike[] = []
  const statuses: string[] = []
  const createWebSocket = (): WebSocketLike => {
    const ws: WebSocketLike = {
      readyState: 0,
      onopen: null,
      onmessage: null,
      onclose: null,
      onerror: null,
      send: () => undefined,
      close: () => undefined,
    }
    sockets.push(ws)
    return ws
  }
  const socket = createTurnSocket({
    conversationId: 'conv_1',
    url: 'ws://test/websocket',
    onEvent: () => undefined,
    onStatus: (status) => statuses.push(status),
    openTurns: () => [],
    createWebSocket,
    ...extra,
  })
  return { socket, sockets, statuses, createWebSocket }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('the driver and its statechart', () => {
  it('adopts the preparation in flight when a connect follows a close: one auth refresh, one socket', async () => {
    // What the chat does when the server says the token expired: close, then connect.
    const refreshAuth = vi.fn(async () => undefined)
    const { socket, sockets, statuses } = setup({ refreshAuth })
    const first = socket.connect()
    socket.close()
    const second = socket.connect()
    await Promise.all([first, second])
    expect(statuses).toEqual(['connecting', 'closed'])
    expect(refreshAuth).toHaveBeenCalledOnce()
    expect(sockets).toHaveLength(1)
  })

  it('rejects the connect when the socket cannot be constructed, and tries again when asked', async () => {
    let refuse = true
    const made = setup()
    const { socket, statuses } = setup({
      createWebSocket: () => {
        if (refuse) throw new Error('refused')
        return made.createWebSocket()
      },
    })
    await expect(socket.connect()).rejects.toThrow('refused')
    refuse = false
    await socket.connect()
    expect(statuses).toEqual(['connecting', 'connecting'])
    expect(made.sockets).toHaveLength(1)
  })

  it('keeps running when a status callback throws, and reports the error as uncaught', async () => {
    vi.useFakeTimers()
    const seen: string[] = []
    const { socket, sockets } = setup({
      onStatus: (status) => {
        seen.push(status)
        if (seen.length === 1) throw new Error('caller bug')
      },
    })
    await socket.connect()
    expect(sockets).toHaveLength(1)
    expect(() => vi.advanceTimersByTime(1)).toThrow('caller bug')
    socket.close()
    expect(seen).toEqual(['connecting', 'closed'])
  })
})
