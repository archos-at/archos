import { createActor, fromCallback } from 'xstate'
import type { RetryLadderOptions } from '@/shared/utils/backoff'
import { getWebSocketUrl } from './config'
import { browserPageLifecycle, isActive, sleptThrough, type PageLifecycle } from './page-lifecycle'
import { turnSocketMachine, type TurnSocketEvent, type TurnSocketStatus } from './turn-socket-machine'
import { WIRE_VERSION, parseHello, parseWireEvent, type ClientMessage, type WireEvent } from './wire-v2'

export { DIAL_TIMEOUT_MS } from './turn-socket-machine'
export type { TurnSocketStatus } from './turn-socket-machine'

export interface OpenTurn {
  turnId: string
  lastSeq: number
  settled?: true
}

export interface TurnSocketOptions {
  conversationId: string
  projectId?: string
  url?: string
  onEvent: (event: WireEvent) => void
  onStatus?: (status: TurnSocketStatus) => void
  openTurns: () => readonly OpenTurn[]
  onSilent?: (turnIds: readonly string[]) => void
  refreshAuth?: () => Promise<void>
  ladder?: RetryLadderOptions
  createWebSocket?: (url: string) => WebSocketLike
  lifecycle?: PageLifecycle
}

export interface WebSocketLike {
  readonly readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  send: (data: string) => void
  close: () => void
}

export interface TurnSocket {
  connect: () => Promise<void>
  send: (message: ClientMessage) => boolean
  accepts: (entry: string) => boolean
  reconnect: () => void
  close: () => void
}

export const HELLO_TIMEOUT_MS = 5_000

export const PREPARE_TIMEOUT_MS = 10_000

const asBlockquote = (excerpt: string): string =>
  excerpt
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')

export const forServer = (message: ClientMessage, accepts: ReadonlySet<string>): ClientMessage | null => {
  if (message.type === 'steer') return accepts.has('steer') ? message : null
  if (message.type === 'cancel_turn' && message.shown && !accepts.has('cancel_turn.shown')) {
    const { shown: _unread, ...rest } = message
    return rest
  }
  if (message.type !== 'user_message') return message
  let shaped = message
  if (shaped.posthog_session_id !== undefined && !accepts.has('user_message.posthog_session_id')) {
    const { posthog_session_id: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.focus_region !== undefined && !accepts.has('user_message.focus_region')) {
    const { focus_region: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.reply_in_thread !== undefined && !accepts.has('user_message.reply_in_thread')) {
    const { reply_in_thread: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.trigger !== undefined && !accepts.has('user_message.trigger')) {
    const { trigger: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.if_idle !== undefined && !accepts.has('user_message.if_idle')) {
    const { if_idle: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.client_tools !== undefined && !accepts.has('user_message.client_tools')) {
    const { client_tools: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.answer_excerpt != null && !accepts.has('user_message.answer_excerpt')) {
    const { answer_excerpt: excerpt, ...rest } = shaped
    shaped = { ...rest, text: `${asBlockquote(excerpt)}\n\n${rest.text}` }
  }
  return shaped
}

const DEFAULT_BEAT_MS = 20_000
const DEAD_AFTER_BEATS = 3
const OPEN = 1

const jsonOf = (data: unknown): unknown => {
  try {
    return JSON.parse(String(data))
  } catch {
    return undefined
  }
}

const typeOf = (raw: unknown): string => {
  const record = raw !== null && typeof raw === 'object' ? (raw as { type?: unknown; name?: unknown }) : {}
  return [record.type, record.name].filter((part) => typeof part === 'string').join(':') || typeof raw
}

const guarded = (run: () => void): void => {
  try {
    run()
  } catch (error) {
    setTimeout(() => {
      throw error
    })
  }
}

export function createTurnSocket(options: TurnSocketOptions): TurnSocket {
  const lifecycle = options.lifecycle ?? browserPageLifecycle()
  let awaySince: number | null = isActive(lifecycle) ? null : Date.now()
  let heardAt = 0
  const warned = new Set<string>()
  let socket: WebSocketLike | null = null
  let opening: Promise<void> | null = null
  let ready = false
  let accepts: ReadonlySet<string> = new Set()
  let everyMs = DEFAULT_BEAT_MS
  let heard: (() => void) | null = null

  const warnOnce = (what: string, raw?: unknown): void => {
    const detail = raw === undefined ? '' : typeOf(raw)
    const key = `${what}:${detail}`
    if (!warned.has(key)) console.warn(`[turn-socket] ${what}`, detail)
    warned.add(key)
  }

  const drop = (): void => {
    const current = socket
    socket = null
    ready = false
    accepts = new Set()
    if (!current) return
    current.onopen = current.onmessage = current.onclose = current.onerror = null
    current.close()
  }

  const wasAway = (armedAt: number, ms: number): boolean =>
    awaySince !== null || !isActive(lifecycle) || sleptThrough(armedAt, ms)

  const send = (message: ClientMessage): boolean => {
    if (!ready || socket?.readyState !== OPEN) return false
    const shaped = forServer(message, accepts)
    if (!shaped) return false
    socket.send(JSON.stringify(shaped))
    return true
  }

  const receive = (data: unknown, tell: (event: TurnSocketEvent) => void): void => {
    heardAt = Date.now()
    const raw = jsonOf(data)
    if (!ready) {
      const hello = parseHello(raw)
      if (!hello) {
        warnOnce('opened with something other than a v2 hello', raw)
        return tell({ type: 'GREETING_FOREIGN' })
      }
      ready = true
      accepts = new Set(hello.value.accepts ?? [])
      return tell({ type: 'HELLO' })
    }
    const event = parseWireEvent(raw)
    if (!event) {
      warnOnce('not a v2 event this page can read', raw)
      return tell({ type: 'FRAME_UNREADABLE' })
    }
    if (event.type === 'CUSTOM' && event.name === 'heartbeat') everyMs = event.value.every_ms
    heard?.()
    options.onEvent(event)
  }

  const urlOf = async (): Promise<string> => {
    const base = options.url ?? (await getWebSocketUrl())
    const params = new URLSearchParams({ v: String(WIRE_VERSION), conversationId: options.conversationId })
    if (options.projectId) params.set('projectId', options.projectId)
    return `${base}${base.includes('?') ? '&' : '?'}${params}`
  }

  const socketActor = fromCallback<TurnSocketEvent, { url: string }>(({ input, sendBack }) => {
    let ws: WebSocketLike
    try {
      ws = options.createWebSocket ? options.createWebSocket(input.url) : new WebSocket(input.url)
    } catch (error) {
      warnOnce(`could not construct a socket: ${String(error)}`)
      sendBack({ type: 'SOCKET_REFUSED' })
      return undefined
    }
    socket = ws
    ws.onopen = () => {
      if (socket === ws) sendBack({ type: 'SOCKET_OPENED' })
    }
    ws.onmessage = (message: MessageEvent) => {
      if (socket === ws) receive(message.data, sendBack)
    }
    ws.onclose = (event: CloseEvent) => {
      if (socket !== ws) return
      socket = null
      ready = false
      sendBack({ type: 'SOCKET_CLOSED', code: event.code })
    }
    return () => {
      if (socket === ws) drop()
    }
  })

  const helloTimer = fromCallback<TurnSocketEvent>(({ sendBack }) => {
    const armedAt = Date.now()
    const timer = setTimeout(() => {
      const pageWasAway = wasAway(armedAt, HELLO_TIMEOUT_MS)
      if (!pageWasAway) warnOnce('no hello within the timeout')
      sendBack({ type: 'HELLO_TIMED_OUT', pageWasAway })
    }, HELLO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  })

  const silenceWatch = fromCallback<TurnSocketEvent>(({ sendBack }) => {
    let timer: ReturnType<typeof setTimeout> | null = null
    const arm = (): void => {
      if (timer) clearTimeout(timer)
      const armedAt = Date.now()
      const ms = DEAD_AFTER_BEATS * everyMs
      timer = setTimeout(() => {
        timer = null
        const turnIds = options
          .openTurns()
          .filter((turn) => !turn.settled)
          .map((turn) => turn.turnId)
        if (turnIds.length > 0) sendBack({ type: 'WATCHDOG_EXPIRED', turnIds, pageWasAway: wasAway(armedAt, ms) })
      }, ms)
    }
    heard = arm
    arm()
    return () => {
      if (timer) clearTimeout(timer)
      if (heard === arm) heard = null
    }
  })

  const page = fromCallback<TurnSocketEvent>(({ sendBack }) => {
    if (isActive(lifecycle)) awaySince = null
    else awaySince ??= Date.now()
    return lifecycle.subscribe({
      resume: () => {
        const since = awaySince
        awaySince = null
        const socketWentQuiet = since !== null && heardAt < since && Date.now() - since > everyMs
        sendBack({ type: 'PAGE_RESUMED', socketWentQuiet })
      },
      suspend: () => {
        if (!isActive(lifecycle)) awaySince ??= Date.now()
        sendBack({ type: 'PAGE_SUSPENDED' })
      },
    })
  })

  const prepare = async (): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const overdue = new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), PREPARE_TIMEOUT_MS)
    })
    const address = (async () => {
      await options.refreshAuth?.().catch(() => undefined)
      return urlOf()
    })()
    let url: string | null
    try {
      url = await Promise.race([address, overdue])
    } catch (error) {
      warnOnce(`could not prepare an attempt: ${String(error)}`)
      actor.send({ type: 'PREPARE_FAILED' })
      return
    } finally {
      clearTimeout(timer)
    }
    if (url === null) {
      address.catch(() => undefined)
      warnOnce('an attempt was not prepared within the timeout')
      actor.send({ type: 'PREPARE_FAILED' })
      return
    }
    actor.send({ type: 'PREPARED', url })
  }

  const actor = createActor(
    turnSocketMachine.provide({
      actors: { page, socket: socketActor, helloTimer, silenceWatch },
      actions: {
        announce: (_, { status }) => guarded(() => options.onStatus?.(status)),
        prepare: () => {
          opening = prepare().finally(() => (opening = null))
        },
        dropSocket: drop,
        attachOpenTurns: () =>
          guarded(() => {
            for (const turn of options.openTurns()) {
              send({
                type: 'attach',
                conversation_id: options.conversationId,
                turn_id: turn.turnId,
                after_seq: turn.lastSeq,
              })
            }
          }),
        reportSilence: (_, { turnIds }) => guarded(() => options.onSilent?.(turnIds)),
      },
      guards: {
        pageHidden: () => !lifecycle.visible,
        pageOffline: () => !lifecycle.online,
      },
    }),
    { input: { ladder: options.ladder ?? { baseMs: 1_000, maxMs: 30_000, budget: 12 } } }
  )
  actor.start()

  return {
    connect: () => {
      actor.send({ type: 'CONNECT' })
      return opening ?? Promise.resolve()
    },
    send,
    accepts: (entry) => ready && accepts.has(entry),
    reconnect: () => actor.send({ type: 'RECONNECT' }),
    close: () => {
      ready = false
      actor.send({ type: 'CLOSE' })
    },
  }
}
