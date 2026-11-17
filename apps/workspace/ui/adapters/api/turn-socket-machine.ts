import { assign, enqueueActions, fromCallback, setup } from 'xstate'
import { backoffWithJitter, type RetryLadderOptions } from '@/shared/utils/backoff'
import { CLOSE_CLIENT_OUTDATED } from './wire-v2'

export type TurnSocketStatus =
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'failed'
  | 'incompatible'
  | 'outdated'
  | 'suspended'
  | 'offline'
  | 'closed'

export type TurnSocketEvent =
  | { type: 'CONNECT' }
  | { type: 'RECONNECT' }
  | { type: 'CLOSE' }
  | { type: 'PREPARED'; url: string }
  | { type: 'PREPARE_FAILED' }
  | { type: 'SOCKET_REFUSED' }
  | { type: 'SOCKET_OPENED' }
  | { type: 'HELLO' }
  | { type: 'GREETING_FOREIGN' }
  | { type: 'FRAME_UNREADABLE' }
  | { type: 'SOCKET_CLOSED'; code: number }
  | { type: 'HELLO_TIMED_OUT'; pageWasAway: boolean }
  | { type: 'WATCHDOG_EXPIRED'; turnIds: readonly string[]; pageWasAway: boolean }
  | { type: 'PAGE_SUSPENDED' }
  | { type: 'PAGE_RESUMED'; socketWentQuiet: boolean }

export interface TurnSocketContext {
  ladder: RetryLadderOptions
  attempts: number
  lastFailure: 'failed' | 'incompatible'
  preparing: boolean
}

export const hasRung = (ladder: RetryLadderOptions, index: number): boolean =>
  'delaysMs' in ladder ? ladder.delaysMs[index] !== undefined : ladder.budget === undefined || index < ladder.budget

export const rungDelayMs = (ladder: RetryLadderOptions, index: number): number =>
  'delaysMs' in ladder ? (ladder.delaysMs[index] ?? 0) : backoffWithJitter(index, ladder)

export const DIAL_TIMEOUT_MS = 15_000

const announce = (status: TurnSocketStatus) => ({ type: 'announce' as const, params: { status } })

const provided = <TInput = unknown>() => fromCallback<TurnSocketEvent, TInput>(() => undefined)

export const turnSocketMachine = setup({
  types: {
    context: {} as TurnSocketContext,
    events: {} as TurnSocketEvent,
    input: {} as { ladder: RetryLadderOptions },
  },
  actors: {
    page: provided(),
    socket: provided<{ url: string }>(),
    helloTimer: provided(),
    silenceWatch: provided(),
  },
  actions: {
    announce: (_, _params: { status: TurnSocketStatus }) => undefined,
    prepare: () => undefined,
    dropSocket: () => undefined,
    attachOpenTurns: () => undefined,
    reportSilence: (_, _params: { turnIds: readonly string[] }) => undefined,
    resetLadder: assign({ attempts: 0 }),
    resetSpentLadder: assign({
      attempts: ({ context }) => (hasRung(context.ladder, context.attempts) ? context.attempts : 0),
    }),
    takeRung: assign({ attempts: ({ context }) => context.attempts + 1 }),
    prepared: assign({ preparing: false }),
    blameTheDialect: assign({ lastFailure: 'incompatible' }),
  },
  guards: {
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
    rung: ({ context }) => rungDelayMs(context.ladder, context.attempts - 1),
    dialLimit: DIAL_TIMEOUT_MS,
  },
}).createMachine({
  id: 'turnSocket',
  context: ({ input }) => ({ ladder: input.ladder, attempts: 0, lastFailure: 'failed', preparing: false }),
  initial: 'idle',
  on: {
    CLOSE: { target: '.closed' },
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
            CONNECT: { actions: 'resetSpentLadder' },
            RECONNECT: { actions: 'resetLadder' },
            PAGE_RESUMED: { actions: 'resetLadder' },
            PAGE_SUSPENDED: {},
            PREPARED: {
              target: 'connected',
              actions: assign({ preparing: false, lastFailure: 'failed' }),
            },
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
            PAGE_SUSPENDED: {},
            SOCKET_CLOSED: [{ guard: 'clientOutdated', target: 'outdated' }, { target: 'retry' }],
          },
          states: {
            dialing: {
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
