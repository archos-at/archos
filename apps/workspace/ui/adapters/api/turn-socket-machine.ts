/**
 * The chat socket's connection status, as one statechart (ADR-0179 names this
 * socket as a machine a table cannot express: a ladder, two timers, a page
 * that goes away).
 *
 * The machine owns three things: which status the socket is in, the reconnect
 * ladder (how many rungs are taken, in context), and why the last attempt
 * failed. It decides every move and announces every status. It does not touch
 * a WebSocket, a clock or the page: those are the driver's
 * (`turn-socket.ts`), handed in as actors, actions and two guards, and each
 * tells the machine what happened as an event. A frame is parsed by the
 * driver; the machine hears only what a frame meant for the connection.
 *
 * Pure: nothing here reads a browser global, so the same chart runs in the
 * BFF's wake job and is walked in `turn-socket-machine.spec.ts` with XState's
 * `transition` and no socket at all.
 *
 * Reading the chart:
 *
 * - `idle` and `closed` are the caller's: nothing runs, the page is not
 *   listened to. `idle` is `closed` before anything was ever announced.
 * - `active` listens to the page. Inside it an attempt is `opening` (auth
 *   refresh and URL), then `connected` (a socket exists: `dialing`, `greeting`
 *   until the hello, `open`). A failed attempt passes through `retry`, which
 *   rests nowhere: it lands in `suspended` or `offline` when nobody can see an
 *   attempt through, in `reconnecting` while the ladder has a rung, and in
 *   `failed` or `incompatible` when it has none. An attempt whose preparation
 *   threw, or whose socket could not be constructed, failed like any other:
 *   it used to rest at `connecting` for good, and the chat said nothing. So
 *   did one that never answered: a preparation is bounded by the driver, which
 *   says `PREPARE_FAILED` (it outlives a close, and a state's timer does not),
 *   and a dial by `dialLimit` here.
 * - A suspend moves a state without a socket to `suspended` or `offline`, and
 *   only when the page really is hidden or offline. It is never a failed
 *   attempt: read as one, it spent a rung and said `failed` a second time.
 * - `outdated` stays inside `active` and ignores the page: only the caller
 *   leaves it.
 */

import { assign, enqueueActions, fromCallback, setup } from 'xstate'
import { backoffWithJitter, type RetryLadderOptions } from '@/shared/utils/backoff'
import { CLOSE_CLIENT_OUTDATED } from './wire-v2'

export type TurnSocketStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  /** The ladder is spent and the last attempt never reached a server. */
  | 'failed'
  /** The ladder is spent and the last attempt reached a server that does not speak wire v2. */
  | 'incompatible'
  /** The server speaks a newer wire than this page: 4426, or a frame this bundle cannot read. */
  | 'outdated'
  /** The page is hidden (locked, in the background): nothing is tried until it is visible. */
  | 'suspended'
  /** The browser has no network: nothing is tried until it is back. */
  | 'offline'
  | 'closed'

export type TurnSocketEvent =
  /** The caller: open or keep open, drop and open afresh, stop. */
  | { type: 'CONNECT' }
  | { type: 'RECONNECT' }
  | { type: 'CLOSE' }
  /** The attempt's auth refresh and URL are done, or threw. */
  | { type: 'PREPARED'; url: string }
  | { type: 'PREPARE_FAILED' }
  /** The socket could not even be constructed. */
  | { type: 'SOCKET_REFUSED' }
  | { type: 'SOCKET_OPENED' }
  /** The first frame was a v2 hello. */
  | { type: 'HELLO' }
  /** The first frame was anything else: a server in another dialect. */
  | { type: 'GREETING_FOREIGN' }
  /** A frame after the hello that this bundle cannot read. */
  | { type: 'FRAME_UNREADABLE' }
  | { type: 'SOCKET_CLOSED'; code: number }
  /** No hello in time. `pageWasAway`: the timer measured a frozen page, not the server. */
  | { type: 'HELLO_TIMED_OUT'; pageWasAway: boolean }
  /** Three beats without a frame while these turns ran. `pageWasAway` as above. */
  | { type: 'WATCHDOG_EXPIRED'; turnIds: readonly string[]; pageWasAway: boolean }
  /** The page went hidden or offline. */
  | { type: 'PAGE_SUSPENDED' }
  /** Visible and online again. `socketWentQuiet`: an open socket heard nothing while away for longer than a beat. */
  | { type: 'PAGE_RESUMED'; socketWentQuiet: boolean }

export interface TurnSocketContext {
  ladder: RetryLadderOptions
  /** Rungs of the ladder taken since the last evidence that it works. */
  attempts: number
  /** Why the last attempt failed, which names the status when the ladder is spent. */
  lastFailure: 'failed' | 'incompatible'
  /**
   * An attempt's preparation is in flight. It outlives a close, so a connect
   * that follows a close at once adopts it: one auth refresh, one `connecting`.
   */
  preparing: boolean
}

/** Whether the ladder has a rung at `index`. The same rule as `createRetryLadder`, which the spec holds it to. */
export const hasRung = (ladder: RetryLadderOptions, index: number): boolean =>
  'delaysMs' in ladder ? ladder.delaysMs[index] !== undefined : ladder.budget === undefined || index < ladder.budget

/** The wait before the attempt at rung `index`. Draws from the ladder's `random` when it is an exponential one. */
export const rungDelayMs = (ladder: RetryLadderOptions, index: number): number =>
  'delaysMs' in ladder ? (ladder.delaysMs[index] ?? 0) : backoffWithJitter(index, ladder)

/**
 * How long a socket may take to open (`dialing`: TCP, TLS, the proxy, and the
 * gateway's scope lookup, which happens before the upgrade completes). A
 * browser gives a dial no bound of its own short of the operating system's,
 * and Node's `ws` none at all, so a server that accepts and never upgrades
 * held the status at `connecting` for good. Fifteen seconds is what the chat
 * already gives a server to acknowledge a question across the same path
 * (`ACK_TIMEOUT_MS`), and three times the hello's bound, which covers one
 * round trip in process. It is also long enough that the headless turn's own
 * 45 s deadline still speaks before four hung dials have spent its ladder.
 */
export const DIAL_TIMEOUT_MS = 15_000

const announce = (status: TurnSocketStatus) => ({ type: 'announce' as const, params: { status } })

/** A stand-in for an actor the driver provides: it does nothing and says nothing. */
const provided = <TInput = unknown>() => fromCallback<TurnSocketEvent, TInput>(() => undefined)

export const turnSocketMachine = setup({
  types: {
    context: {} as TurnSocketContext,
    events: {} as TurnSocketEvent,
    input: {} as { ladder: RetryLadderOptions },
  },
  actors: {
    /** Listens to the page; sends `PAGE_SUSPENDED` and `PAGE_RESUMED`. */
    page: provided(),
    /** The WebSocket of one attempt; sends every `SOCKET_*`, `HELLO`, `GREETING_FOREIGN`, `FRAME_UNREADABLE`. */
    socket: provided<{ url: string }>(),
    /** Not a plain delay: when it fires it must say whether the page slept through it. Sends `HELLO_TIMED_OUT`. */
    helloTimer: provided(),
    /** Re-armed by every frame, for three of the server's own beats. Sends `WATCHDOG_EXPIRED`. */
    silenceWatch: provided(),
  },
  actions: {
    announce: (_, _params: { status: TurnSocketStatus }) => undefined,
    /** Start the auth refresh and the URL; answer `PREPARED` or `PREPARE_FAILED`, also after a close. */
    prepare: () => undefined,
    /**
     * Detach and close the socket now. Leaving `connected` also stops the
     * socket actor, but XState stops a child at the end of the step, after the
     * next status is announced, and a status must never be announced over a
     * socket that can still send.
     */
    dropSocket: () => undefined,
    attachOpenTurns: () => undefined,
    reportSilence: (_, _params: { turnIds: readonly string[] }) => undefined,
    resetLadder: assign({ attempts: 0 }),
    /** A connect after the ladder gave up is a new request, and gets a new ladder. */
    resetSpentLadder: assign({
      attempts: ({ context }) => (hasRung(context.ladder, context.attempts) ? context.attempts : 0),
    }),
    takeRung: assign({ attempts: ({ context }) => context.attempts + 1 }),
    prepared: assign({ preparing: false }),
    blameTheDialect: assign({ lastFailure: 'incompatible' }),
  },
  guards: {
    /** Read live by the driver. A server has no page: never hidden, never offline. */
    pageHidden: () => false,
    pageOffline: () => false,
    hasRung: ({ context }) => hasRung(context.ladder, context.attempts),
    dialectWasForeign: ({ context }) => context.lastFailure === 'incompatible',
    clientOutdated: ({ event }) => event.type === 'SOCKET_CLOSED' && event.code === CLOSE_CLIENT_OUTDATED,
    pageWasAway: ({ event }) =>
      (event.type === 'HELLO_TIMED_OUT' || event.type === 'WATCHDOG_EXPIRED') && event.pageWasAway,
    socketKeptTalking: ({ event }) => event.type === 'PAGE_RESUMED' && !event.socketWentQuiet,
  },
  delays: {
    // `takeRung` has run by the time this is read, so the rung just taken is the one before `attempts`.
    rung: ({ context }) => rungDelayMs(context.ladder, context.attempts - 1),
    dialLimit: DIAL_TIMEOUT_MS,
  },
}).createMachine({
  id: 'turnSocket',
  context: ({ input }) => ({ ladder: input.ladder, attempts: 0, lastFailure: 'failed', preparing: false }),
  initial: 'idle',
  on: {
    CLOSE: { target: '.closed' },
    // A preparation that finishes after its attempt was closed opens nothing.
    PREPARED: { actions: 'prepared' },
    PREPARE_FAILED: { actions: 'prepared' },
  },
  states: {
    idle: {
      on: {
        CONNECT: { target: 'active', actions: 'resetSpentLadder' },
        RECONNECT: { target: 'active', actions: 'resetLadder' },
      },
    },
    closed: {
      entry: announce('closed'),
      on: {
        CONNECT: { target: 'active', actions: 'resetSpentLadder' },
        RECONNECT: { target: 'active', actions: 'resetLadder' },
      },
    },
    active: {
      invoke: { id: 'page', src: 'page' },
      initial: 'opening',
      on: {
        CONNECT: { target: '.opening', actions: 'resetSpentLadder' },
        RECONNECT: { target: '.opening', actions: 'resetLadder' },
        PAGE_RESUMED: { target: '.opening', actions: 'resetLadder' },
        // A rung waiting to fire is not spent on a page nobody can see through.
        // A page that is still visible and online did not go away: nothing moves.
        PAGE_SUSPENDED: [
          { guard: 'pageHidden', target: '.suspended' },
          { guard: 'pageOffline', target: '.offline' },
        ],
      },
      states: {
        opening: {
          entry: enqueueActions(({ context, enqueue }) => {
            if (context.preparing) return
            enqueue(announce('connecting'))
            enqueue.assign({ preparing: true })
            enqueue('prepare')
          }),
          on: {
            // The attempt in flight is the one asked for: only the ladder moves.
            CONNECT: { actions: 'resetSpentLadder' },
            RECONNECT: { actions: 'resetLadder' },
            PAGE_RESUMED: { actions: 'resetLadder' },
            PAGE_SUSPENDED: {},
            PREPARED: {
              target: 'connected',
              actions: assign({ preparing: false, lastFailure: 'failed' }),
            },
            // This attempt never reached a server, whatever the one before it met.
            PREPARE_FAILED: { target: 'retry', actions: assign({ preparing: false, lastFailure: 'failed' }) },
          },
        },
        connected: {
          invoke: {
            id: 'socket',
            src: 'socket',
            input: ({ event }) => ({ url: event.type === 'PREPARED' ? event.url : '' }),
          },
          exit: 'dropSocket',
          initial: 'dialing',
          on: {
            CONNECT: { actions: 'resetSpentLadder' },
            // A socket is kept through a page away: it may well live through it.
            PAGE_SUSPENDED: {},
            SOCKET_CLOSED: [{ guard: 'clientOutdated', target: 'outdated' }, { target: 'retry' }],
          },
          states: {
            dialing: {
              // A dial nobody answers failed like any other. This attempt reached no server.
              after: { dialLimit: { target: '#turnSocket.active.retry' } },
              on: {
                SOCKET_REFUSED: { target: '#turnSocket.active.retry' },
                SOCKET_OPENED: { target: 'greeting' },
                HELLO: { target: 'open', actions: 'resetLadder' },
                GREETING_FOREIGN: { target: '#turnSocket.active.retry', actions: 'blameTheDialect' },
              },
            },
            greeting: {
              invoke: { id: 'helloTimer', src: 'helloTimer' },
              on: {
                HELLO: { target: 'open', actions: 'resetLadder' },
                GREETING_FOREIGN: { target: '#turnSocket.active.retry', actions: 'blameTheDialect' },
                HELLO_TIMED_OUT: [
                  // A freeze between the open and the hello is not another dialect.
                  { guard: 'pageWasAway', target: '#turnSocket.active.retry' },
                  { target: '#turnSocket.active.retry', actions: 'blameTheDialect' },
                ],
              },
            },
            open: {
              entry: [announce('open'), 'attachOpenTurns'],
              invoke: { id: 'silenceWatch', src: 'silenceWatch' },
              on: {
                FRAME_UNREADABLE: { target: '#turnSocket.active.outdated' },
                WATCHDOG_EXPIRED: [
                  // Silence heard while the page was away is the page's, not the turn's.
                  { guard: 'pageWasAway', target: '#turnSocket.active.retry' },
                  {
                    target: '#turnSocket.active.retry',
                    actions: {
                      type: 'reportSilence',
                      params: ({ event }) => ({ turnIds: event.type === 'WATCHDOG_EXPIRED' ? event.turnIds : [] }),
                    },
                  },
                ],
                PAGE_RESUMED: [
                  { guard: 'socketKeptTalking' },
                  { target: '#turnSocket.active.opening', actions: 'resetLadder' },
                ],
              },
            },
          },
        },
        retry: {
          always: [
            // No attempt while nobody can see it through: the ladder keeps its place.
            { guard: 'pageHidden', target: 'suspended' },
            { guard: 'pageOffline', target: 'offline' },
            { guard: 'hasRung', target: 'reconnecting', actions: 'takeRung' },
            { guard: 'dialectWasForeign', target: 'incompatible', actions: announce('reconnecting') },
            { target: 'failed', actions: announce('reconnecting') },
          ],
        },
        reconnecting: {
          entry: announce('reconnecting'),
          after: {
            rung: [
              // A rung that falls due on a page gone away since tries nothing either.
              { guard: 'pageHidden', target: 'suspended' },
              { guard: 'pageOffline', target: 'offline' },
              { target: 'opening' },
            ],
          },
        },
        suspended: { entry: announce('suspended') },
        offline: { entry: announce('offline') },
        failed: { entry: announce('failed') },
        incompatible: { entry: announce('incompatible') },
        outdated: {
          entry: announce('outdated'),
          on: { PAGE_SUSPENDED: {}, PAGE_RESUMED: {} },
        },
      },
    },
  },
})
