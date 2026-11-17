/**
 * @vitest-environment node
 */
/**
 * The seams between the driver and its statechart that `turn-socket.spec.ts`
 * does not reach: a preparation that outlives a close, one that never answers,
 * a socket that cannot be constructed or never opens, and a caller's callback
 * that throws inside a machine step.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DIAL_TIMEOUT_MS,
  PREPARE_TIMEOUT_MS,
  createTurnSocket,
  type TurnSocketOptions,
  type WebSocketLike,
} from './turn-socket'
import { getWebSocketUrl } from './config'

vi.mock('./config', () => ({ getWebSocketUrl: vi.fn() }))

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
  vi.restoreAllMocks()
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

  it('sends nothing more once close was called, also from inside the open announcement', async () => {
    const sent: string[] = []
    const opened: WebSocketLike[] = []
    const made = setup()
    let answer: boolean | null = null
    let accepted: boolean | null = null
    const { socket, statuses } = setup({
      openTurns: () => [{ turnId: 'turn_1', lastSeq: 3 }],
      createWebSocket: () => {
        // Born open: `readyState` is read-only on the type, and the hello is what makes it ready.
        const ws: WebSocketLike = { ...made.createWebSocket(), readyState: 1, send: (frame: string) => void sent.push(frame) }
        opened.push(ws)
        return ws
      },
      onStatus: (status) => {
        statuses.push(status)
        if (status !== 'open') return
        socket.close()
        answer = socket.send({ type: 'cancel_turn', conversation_id: 'conv_1', turn_id: 'turn_1' })
        accepted = socket.accepts('steer')
      },
    })
    await socket.connect()
    const ws = opened[0]
    ws.onopen?.({} as Event)
    ws.onmessage?.({
      data: JSON.stringify({ v: 2, type: 'CUSTOM', name: 'hello', ts: 1, value: { build: 'abc1234', accepts: ['steer'] } }),
    } as MessageEvent)
    expect(statuses).toEqual(['connecting', 'open', 'closed'])
    expect(answer).toBe(false)
    expect(accepted).toBe(false)
    // Neither the caller's frame nor the driver's own attach went out on the closing socket.
    expect(sent).toEqual([])
  })

  it('takes the ladder when the socket cannot be constructed, and connects once it can', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let refuse = true
    const made = setup()
    const { socket, statuses } = setup({
      ladder: { delaysMs: [100, 100] },
      createWebSocket: () => {
        if (refuse) throw new Error('refused')
        return made.createWebSocket()
      },
    })
    // Every caller drops this promise (`void socket.connect()`): it must not reject.
    await expect(socket.connect()).resolves.toBeUndefined()
    expect(statuses).toEqual(['connecting', 'reconnecting'])
    refuse = false
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses).toEqual(['connecting', 'reconnecting', 'connecting'])
    expect(made.sockets).toHaveLength(1)
  })

  it('takes the ladder when the socket address cannot be had, and says failed when the ladder is spent', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.mocked(getWebSocketUrl).mockRejectedValue(new Error('no config'))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    const { socket, sockets, statuses } = setup({ url: undefined, ladder: { delaysMs: [100, 100] } })
    await expect(socket.connect()).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses).toEqual(['connecting', 'reconnecting', 'connecting', 'reconnecting', 'connecting', 'reconnecting', 'failed'])
    expect(sockets).toHaveLength(0)
    // The ladder's own attempts have no caller to hand a rejection to.
    vi.useRealTimers()
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })

  it('takes the ladder when a preparation never answers, and its late answer opens nothing', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let release: () => void = () => undefined
    const refreshAuth = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValue(undefined)
    const { socket, sockets, statuses } = setup({ refreshAuth, ladder: { delaysMs: [100, 100] } })
    const connected = socket.connect()
    await vi.advanceTimersByTimeAsync(PREPARE_TIMEOUT_MS - 1)
    expect(statuses).toEqual(['connecting'])
    await vi.advanceTimersByTimeAsync(1)
    // The promise every caller drops is over with the attempt, not with the hung refresh.
    await expect(connected).resolves.toBeUndefined()
    expect(statuses).toEqual(['connecting', 'reconnecting'])
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses).toEqual(['connecting', 'reconnecting', 'connecting'])
    expect(refreshAuth).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)
    // The abandoned refresh answers at last: no second socket, no status.
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(1)
    expect(statuses).toEqual(['connecting', 'reconnecting', 'connecting'])
  })

  it('does not adopt an abandoned preparation when a connect follows a close', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    let release: () => void = () => undefined
    const refreshAuth = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(() => new Promise<void>((resolve) => (release = resolve)))
      .mockResolvedValue(undefined)
    const { socket, sockets, statuses } = setup({ refreshAuth })
    void socket.connect()
    socket.close()
    await vi.advanceTimersByTimeAsync(PREPARE_TIMEOUT_MS)
    expect(statuses).toEqual(['connecting', 'closed'])
    await socket.connect()
    expect(statuses).toEqual(['connecting', 'closed', 'connecting'])
    expect(refreshAuth).toHaveBeenCalledTimes(2)
    expect(sockets).toHaveLength(1)
    release()
    await vi.advanceTimersByTimeAsync(0)
    expect(sockets).toHaveLength(1)
  })

  it('takes the ladder when a socket never opens, and closes the one it gave up on', async () => {
    vi.useFakeTimers()
    const closed: number[] = []
    const made = setup()
    const { socket, statuses } = setup({
      ladder: { delaysMs: [100, 100] },
      createWebSocket: () => {
        const index = made.sockets.length
        return { ...made.createWebSocket(), close: () => void closed.push(index) }
      },
    })
    await socket.connect()
    await vi.advanceTimersByTimeAsync(DIAL_TIMEOUT_MS - 1)
    expect(statuses).toEqual(['connecting'])
    await vi.advanceTimersByTimeAsync(1)
    expect(statuses).toEqual(['connecting', 'reconnecting'])
    expect(closed).toEqual([0])
    await vi.advanceTimersByTimeAsync(100)
    expect(statuses).toEqual(['connecting', 'reconnecting', 'connecting'])
    expect(made.sockets).toHaveLength(2)
    socket.close()
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
