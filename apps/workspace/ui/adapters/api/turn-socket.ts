/**
 * The chat socket, v2 (`docs/design/chat-wire-v2.md` §e.2): connect, send,
 * reconnect, and nothing that interprets a turn. Every frame is parsed by
 * `parseWireEvent` and handed on; `foldTurnEvent` is the only reader.
 *
 * - **Version, both ways.** The upgrade asks for `?v=2`, and close code 4426
 *   means this page is older than the server: `outdated`, and no reconnect.
 *   The other way round is the `hello`: the server's first frame says it
 *   speaks v2. Until it arrives the socket is not `open` and sends nothing. A
 *   socket that stays silent for {@link HELLO_TIMEOUT_MS}, or opens with
 *   anything else, reached a server that does not speak this wire (an agent
 *   rolled back to the agent runtime's stock socket accepts the upgrade and ignores `?v=2`):
 *   the attempt failed, and when the ladder is spent the status is
 *   `incompatible`, not `failed`, because the network is fine.
 * - **Optional fields, by the hello.** The server reads what the client sends
 *   strictly: an unknown field refuses the message. A field added to a client
 *   message is therefore sent only to a server whose hello names it in
 *   `accepts` ({@link forServer}): during a rolling deploy the socket may have
 *   reached a pod one release older, and a Stop it refused would leave the
 *   turn running. The check is made on the socket that sends, so a message
 *   held across a reconnect is shaped for the server it finally reaches. A
 *   whole message type the hello does not name (`steer`) is not sent at all:
 *   `send` returns false and the caller keeps it (a note becomes the next
 *   question).
 * - **Drift.** After the hello, a frame this page cannot parse means the
 *   server speaks a newer v2 than this bundle: `outdated`, as for 4426. It is
 *   never dropped and waited past, because a turn whose next `seq` cannot be
 *   read can never fold another event, its terminal included. Additive drift
 *   (an unknown key; an unknown `type`, step `kind` or `CUSTOM` name) parses:
 *   `parseWireEvent` reads it, and the fold passes over what it does not know.
 * - **Resume.** On every reopen, each running turn is re-`attach`ed from the
 *   last seq its view folded; the server replays from there and continues live.
 *   The caller owns those cursors (`openTurns`), so there is one `lastSeq`.
 * - **Liveness.** While a turn runs, the server beats every `every_ms`. Three
 *   beats with no frame this page could read and the socket is dropped and
 *   reopened, and `onSilent` names the turns it was waiting on, so the caller
 *   can stop waiting on a turn that stays silent across reopens. A question not
 *   yet acknowledged (`RUN_STARTED`) is the caller's to watch (`openTurns`
 *   leaves it out); a turn waiting for its stages (`settled`) gets no beats.
 * - **Status.** Every status and every move between two of them is declared
 *   in `turn-socket-machine.ts`, one XState machine. This file is its driver:
 *   it owns the WebSocket, the frames, the clocks and the page, tells the
 *   machine what happened, and does what the machine decides.
 * - **Backoff.** The machine's ladder (the rule of `createRetryLadder`, with
 *   the count in the machine's context), with the auth refresh before each
 *   attempt: the handshake is the only point where the gateway reads the
 *   cookie. The hello is the evidence that starts the ladder over.
 *   `partysocket` was weighed for this (MIT, 210 KB, one polyfill) and not
 *   taken: the ladder is already ours, and its send queue would replay stale
 *   client messages that `attach` makes wrong.
 * - **A page away is not a server down** (`page-lifecycle.ts`). A phone that
 *   locks freezes the page and iOS kills the socket; a phone on site loses the
 *   network. While the page is hidden or offline no attempt is made and the
 *   ladder keeps its budget (`suspended`, `offline`): twelve rungs spent on a
 *   frozen page used to be gone in four minutes of a ten-minute lock, and the
 *   reader came back to „lost". The moment it is visible and online again (or
 *   restored from the back/forward cache) the socket reopens from the first
 *   rung, and every open turn is attached from its last seq. A ready socket
 *   that heard nothing while the page was away for longer than a beat is
 *   reopened too: it may be dead without its close having fired. A watchdog or
 *   hello timer that fires late, having slept through a freeze, measured the
 *   freeze: it is no strike against the turn and no sign of another dialect.
 */

import { createActor, fromCallback } from 'xstate'
import type { RetryLadderOptions } from '@/shared/utils/backoff'
import { getWebSocketUrl } from './config'
import { browserPageLifecycle, isActive, sleptThrough, type PageLifecycle } from './page-lifecycle'
import { turnSocketMachine, type TurnSocketEvent, type TurnSocketStatus } from './turn-socket-machine'
import { WIRE_VERSION, parseHello, parseWireEvent, type ClientMessage, type WireEvent } from './wire-v2'

export type { TurnSocketStatus } from './turn-socket-machine'

/** A turn still running, and the last seq its view folded. */
export interface OpenTurn {
  turnId: string
  lastSeq: number
  /** Finished, waiting only for its post-answer stages: attached on reopen, never watched. */
  settled?: true
}

export interface TurnSocketOptions {
  conversationId: string
  projectId?: string
  /** Base URL; same-origin `/websocket` by default. */
  url?: string
  onEvent: (event: WireEvent) => void
  onStatus?: (status: TurnSocketStatus) => void
  /** The turns to attach on reopen, and the ones the watchdog guards. */
  openTurns: () => readonly OpenTurn[]
  /** The watchdog dropped the socket: these running turns said nothing for three beats. */
  onSilent?: (turnIds: readonly string[]) => void
  /** Refresh the auth cookie before each attempt. A failure does not stop the attempt. */
  refreshAuth?: () => Promise<void>
  /**
   * Default: 1 s doubling to 30 s, 12 attempts, which outlasts a rolling deploy
   * of both tiers. Attempts are made, and so counted, only while the page is
   * visible and online.
   */
  ladder?: RetryLadderOptions
  /**
   * How a socket is opened: the browser's `WebSocket` by default. A server
   * caller (the BFF's wake job, ADR-0106) passes one built on Node's `ws`,
   * which can set the upgrade's headers a browser cannot.
   */
  createWebSocket?: (url: string) => WebSocketLike
  /** Whether the page is visible and online, and when it is again. The browser's by default; none on a server. */
  lifecycle?: PageLifecycle
}

/** The part of a WebSocket this driver uses, which the browser's and Node's `ws` both have. */
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
  /** Open, or keep open. After the ladder gave up, a new ladder: this is a new request. */
  connect: () => Promise<void>
  /**
   * False when the socket is not open (no hello yet), or when its server does
   * not read this message type (`forServer` returned null); nothing is queued.
   */
  send: (message: ClientMessage) => boolean
  /** Whether the open socket's server named `entry` in its hello (`steer`, `user_message.trigger`). */
  accepts: (entry: string) => boolean
  /** Drop the current socket, if any, and open a fresh one now, from the first rung. */
  reconnect: () => void
  close: () => void
}

/**
 * How long a socket that opened may take to say hello. The server sends it
 * right after `accept()`, the version check and the token check, all in
 * process, so it is one round trip behind `onopen`; the gateway's scope lookup
 * happens before the upgrade completes and does not count. Five seconds is
 * many times that, and short enough that a server in another dialect costs one
 * rung of the ladder rather than a turn.
 */
export const HELLO_TIMEOUT_MS = 5_000

/**
 * `message` as the server whose hello said `accepts` can read it: an optional
 * field it does not name is left out, and the rest of the message still goes.
 * Without the field the server does what it did before it existed: a Stop
 * without `shown` keeps everything streamed so far.
 */
export const forServer = (message: ClientMessage, accepts: ReadonlySet<string>): ClientMessage | null => {
  // A note for the running turn is a message type of its own, and a server
  // that does not name it refuses the frame. Not sent: the caller keeps it and
  // asks it as the next question once the turn has ended.
  if (message.type === 'steer') return accepts.has('steer') ? message : null
  if (message.type === 'cancel_turn' && message.shown && !accepts.has('cancel_turn.shown')) {
    const { shown: _unread, ...rest } = message
    return rest
  }
  // The PostHog session id links the turn's Langfuse trace to the recording. A
  // server that does not read it refuses the whole question, the key present
  // even as null, so the key goes, not the value.
  if (message.type !== 'user_message') return message
  let shaped = message
  if (shaped.posthog_session_id !== undefined && !accepts.has('user_message.posthog_session_id')) {
    const { posthog_session_id: _unread, ...rest } = shaped
    shaped = rest
  }
  // A box on the review canvas and the ask to answer in its thread. An older
  // server answers the question about the whole document and in the chat only,
  // which is what it did before the canvas could ask: better than refusing it.
  if (shaped.focus_region !== undefined && !accepts.has('user_message.focus_region')) {
    const { focus_region: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.reply_in_thread !== undefined && !accepts.has('user_message.reply_in_thread')) {
    const { reply_in_thread: _unread, ...rest } = shaped
    shaped = rest
  }
  // The two fields a turn an event woke carries (the BFF's wake job). An older
  // server would run it as a typed question; the job checks `accepts` itself
  // before it sends one, because without `if_idle` it would supersede.
  if (shaped.trigger !== undefined && !accepts.has('user_message.trigger')) {
    const { trigger: _unread, ...rest } = shaped
    shaped = rest
  }
  if (shaped.if_idle !== undefined && !accepts.has('user_message.if_idle')) {
    const { if_idle: _unread, ...rest } = shaped
    shaped = rest
  }
  // The frontend tools this page can run (ADR-0144). An older server would refuse the question; without
  // the field it answers as it did before, with no viewer actions.
  if (shaped.client_tools !== undefined && !accepts.has('user_message.client_tools')) {
    const { client_tools: _unread, ...rest } = shaped
    shaped = rest
  }
  return shaped
}

/** The heartbeat interval assumed until the server states its own. */
const DEFAULT_BEAT_MS = 20_000
const DEAD_AFTER_BEATS = 3
const OPEN = 1

/** A frame as JSON, or `undefined` when it is not JSON at all. */
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

/**
 * Run a caller's callback from inside a machine step. What it throws is
 * reported as uncaught, as it was when the socket's own handler ran it, and
 * the step goes on: an error escaping an XState action would stop the machine
 * for good.
 */
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
  /** When the page last went hidden or offline, until it is back. */
  let awaySince: number | null = isActive(lifecycle) ? null : Date.now()
  /** When the current socket last carried a frame. */
  let heardAt = 0
  const warned = new Set<string>()
  let socket: WebSocketLike | null = null
  let opening: Promise<void> | null = null
  /** What constructing the socket threw, for the attempt's promise to reject with. */
  let refused: { error: unknown } | null = null
  /** The current socket's server said hello: it speaks v2, and `send` may use it. */
  let ready = false
  /** The optional client fields the current socket's server named in its hello. */
  let accepts: ReadonlySet<string> = new Set()
  let everyMs = DEFAULT_BEAT_MS
  /** Re-arm the watchdog of the open socket: every frame it can read does. */
  let heard: (() => void) | null = null

  /** Once per cause and frame type: a server in another dialect would otherwise fill the console. */
  const warnOnce = (what: string, raw?: unknown): void => {
    const detail = raw === undefined ? '' : typeOf(raw)
    const key = `${what}:${detail}`
    if (!warned.has(key)) console.warn(`[turn-socket] ${what}`, detail)
    warned.add(key)
  }

  /** Detach and close the current socket without its close event starting anything. */
  const drop = (): void => {
    const current = socket
    socket = null
    ready = false
    accepts = new Set()
    if (!current) return
    current.onopen = current.onmessage = current.onclose = current.onerror = null
    current.close()
  }

  /** The page was away while this timer ran: what it measured is the page, not the server. */
  const wasAway = (armedAt: number, ms: number): boolean =>
    awaySince !== null || !isActive(lifecycle) || sleptThrough(armedAt, ms)

  const send = (message: ClientMessage): boolean => {
    if (!ready || socket?.readyState !== OPEN) return false
    const shaped = forServer(message, accepts)
    if (!shaped) return false
    socket.send(JSON.stringify(shaped))
    return true
  }

  /** What a frame means for the connection goes to the machine; a turn's event goes to the caller. */
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

  /** One attempt's socket. The machine stops it when the attempt is over. */
  const socketActor = fromCallback<TurnSocketEvent, { url: string }>(({ input, sendBack }) => {
    let ws: WebSocketLike
    try {
      ws = options.createWebSocket ? options.createWebSocket(input.url) : new WebSocket(input.url)
    } catch (error) {
      refused = { error }
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

  /** Time out a socket that opened and has not said hello. */
  const helloTimer = fromCallback<TurnSocketEvent>(({ sendBack }) => {
    const armedAt = Date.now()
    const timer = setTimeout(() => {
      const pageWasAway = wasAway(armedAt, HELLO_TIMEOUT_MS)
      if (!pageWasAway) warnOnce('no hello within the timeout')
      sendBack({ type: 'HELLO_TIMED_OUT', pageWasAway })
    }, HELLO_TIMEOUT_MS)
    return () => clearTimeout(timer)
  })

  /** Watch the running turns: three beats with no frame and the socket is dead. */
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

  const page = fromCallback<TurnSocketEvent>(({ sendBack }) =>
    lifecycle.subscribe({
      // A ready socket that heard nothing while the page was away longer than a
      // beat may be dead without its close having reached us (iOS).
      resume: () => {
        const since = awaySince
        awaySince = null
        const socketWentQuiet = since !== null && heardAt < since && Date.now() - since > everyMs
        sendBack({ type: 'PAGE_RESUMED', socketWentQuiet })
      },
      suspend: () => {
        awaySince ??= Date.now()
        sendBack({ type: 'PAGE_SUSPENDED' })
      },
    })
  )

  /** Refresh auth and build the URL, then tell the machine, which opens the socket in the same step. */
  const prepare = async (): Promise<void> => {
    let url: string
    try {
      await options.refreshAuth?.().catch(() => undefined)
      url = await urlOf()
    } catch (error) {
      actor.send({ type: 'PREPARE_FAILED' })
      throw error
    }
    actor.send({ type: 'PREPARED', url })
    const failure = refused
    refused = null
    if (failure) throw failure.error
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
        // The hello: now the socket is open, and every open turn is attached.
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
    close: () => actor.send({ type: 'CLOSE' }),
  }
}
