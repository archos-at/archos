/**
 * @vitest-environment node
 */
/**
 * The chat socket's statechart, walked without a socket. The table below is
 * every resting state against every event, through XState's pure `transition`;
 * the scenarios after it run the chart as an actor with fake actors and fake
 * timers. What a reader of the chat sees is held by `turn-socket.spec.ts`,
 * through the driver; this spec holds the chart itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor, fromCallback, initialTransition, transition, type SnapshotFrom } from 'xstate'
import { createRetryLadder, type RetryLadderOptions } from '@/shared/utils/backoff'
import {
  hasRung,
  rungDelayMs,
  turnSocketMachine,
  type TurnSocketEvent,
  type TurnSocketStatus,
} from './turn-socket-machine'

type Snapshot = SnapshotFrom<typeof turnSocketMachine>

/** The page as the two guards read it. */
interface Page {
  hidden: boolean
  offline: boolean
}

const machineFor = (page: Page) =>
  turnSocketMachine.provide({ guards: { pageHidden: () => page.hidden, pageOffline: () => page.offline } })

/** `active.connected.open` for `{ active: { connected: 'open' } }`. */
const pathOf = (value: unknown): string => {
  if (typeof value === 'string') return value
  const [[key, inner]] = Object.entries(value as Record<string, unknown>)
  return `${key}.${pathOf(inner)}`
}

const RUNG_DUE = { type: 'xstate.after.rung.turnSocket.active.reconnecting' } as unknown as TurnSocketEvent
/** The dial's own bound: a socket that was made and never opened. */
const DIAL_DUE = {
  type: 'xstate.after.dialLimit.turnSocket.active.connected.dialing',
} as unknown as TurnSocketEvent

interface Walk {
  snapshot: Snapshot
  state: string
  /** Every status announced, in order. */
  announced: TurnSocketStatus[]
  /** Every action of the walk by type, in order, with XState's own. */
  actions: string[]
}

const walk = (events: readonly TurnSocketEvent[], ladder: RetryLadderOptions, page: Page, from?: Snapshot): Walk => {
  const machine = machineFor(page)
  let snapshot = from ?? initialTransition(machine, { ladder })[0]
  const announced: TurnSocketStatus[] = []
  const actions: string[] = []
  for (const event of events) {
    const [next, executed] = transition(machine, snapshot, event)
    snapshot = next
    for (const action of executed) {
      actions.push(action.type)
      if (action.type === 'announce') announced.push((action.params as { status: TurnSocketStatus }).status)
    }
  }
  return { snapshot, state: pathOf(snapshot.value), announced, actions }
}

const HERE: Page = { hidden: false, offline: false }
const HIDDEN: Page = { hidden: true, offline: false }
const OFFLINE: Page = { hidden: false, offline: true }

const PREPARED: TurnSocketEvent = { type: 'PREPARED', url: 'ws://test' }
const DROPPED: TurnSocketEvent = { type: 'SOCKET_CLOSED', code: 1006 }
const REFUSED_AS_OUTDATED: TurnSocketEvent = { type: 'SOCKET_CLOSED', code: 4426 }
const TO_DIALING: TurnSocketEvent[] = [{ type: 'CONNECT' }, PREPARED]
const TO_OPEN: TurnSocketEvent[] = [...TO_DIALING, { type: 'SOCKET_OPENED' }, { type: 'HELLO' }]

/** How each resting state is reached: the events, the ladder and the page. */
const REACH: Record<string, { events: TurnSocketEvent[]; ladder: RetryLadderOptions; page: Page }> = {
  idle: { events: [], ladder: { delaysMs: [100, 100] }, page: HERE },
  closed: { events: [{ type: 'CLOSE' }], ladder: { delaysMs: [100, 100] }, page: HERE },
  'active.opening': { events: [{ type: 'CONNECT' }], ladder: { delaysMs: [100, 100] }, page: HERE },
  'active.connected.dialing': { events: TO_DIALING, ladder: { delaysMs: [100, 100] }, page: HERE },
  'active.connected.greeting': {
    events: [...TO_DIALING, { type: 'SOCKET_OPENED' }],
    ladder: { delaysMs: [100, 100] },
    page: HERE,
  },
  'active.connected.open': { events: TO_OPEN, ladder: { delaysMs: [100, 100] }, page: HERE },
  'active.reconnecting': { events: [...TO_DIALING, DROPPED], ladder: { delaysMs: [100, 100] }, page: HERE },
  'active.suspended': { events: [...TO_DIALING, DROPPED], ladder: { delaysMs: [100, 100] }, page: HIDDEN },
  'active.offline': { events: [...TO_DIALING, DROPPED], ladder: { delaysMs: [100, 100] }, page: OFFLINE },
  'active.failed': { events: [...TO_DIALING, DROPPED], ladder: { delaysMs: [] }, page: HERE },
  'active.incompatible': {
    events: [...TO_DIALING, { type: 'GREETING_FOREIGN' }],
    ladder: { delaysMs: [] },
    page: HERE,
  },
  'active.outdated': { events: [...TO_DIALING, REFUSED_AS_OUTDATED], ladder: { delaysMs: [100, 100] }, page: HERE },
}

/** Every event the chart declares, each payload that changes a move, and the ladder's own timer. */
const EVENTS: Record<string, TurnSocketEvent> = {
  CONNECT: { type: 'CONNECT' },
  RECONNECT: { type: 'RECONNECT' },
  CLOSE: { type: 'CLOSE' },
  PREPARED,
  PREPARE_FAILED: { type: 'PREPARE_FAILED' },
  SOCKET_REFUSED: { type: 'SOCKET_REFUSED' },
  SOCKET_OPENED: { type: 'SOCKET_OPENED' },
  HELLO: { type: 'HELLO' },
  GREETING_FOREIGN: { type: 'GREETING_FOREIGN' },
  FRAME_UNREADABLE: { type: 'FRAME_UNREADABLE' },
  'SOCKET_CLOSED(1006)': DROPPED,
  'SOCKET_CLOSED(4426)': REFUSED_AS_OUTDATED,
  HELLO_TIMED_OUT: { type: 'HELLO_TIMED_OUT', pageWasAway: false },
  'HELLO_TIMED_OUT(page away)': { type: 'HELLO_TIMED_OUT', pageWasAway: true },
  WATCHDOG_EXPIRED: { type: 'WATCHDOG_EXPIRED', turnIds: ['t1'], pageWasAway: false },
  'WATCHDOG_EXPIRED(page away)': { type: 'WATCHDOG_EXPIRED', turnIds: ['t1'], pageWasAway: true },
  PAGE_SUSPENDED: { type: 'PAGE_SUSPENDED' },
  'PAGE_RESUMED(kept talking)': { type: 'PAGE_RESUMED', socketWentQuiet: false },
  'PAGE_RESUMED(went quiet)': { type: 'PAGE_RESUMED', socketWentQuiet: true },
  RUNG_DUE,
  DIAL_DUE,
}

type Move = [state: string, ...announced: TurnSocketStatus[]]

const OPENING: Move = ['active.opening', 'connecting']
const CLOSED: Move = ['closed', 'closed']
const RECONNECTING: Move = ['active.reconnecting', 'reconnecting']
const OUTDATED: Move = ['active.outdated', 'outdated']
/** What the caller and the page do to a state with no socket and no attempt in flight. */
const RESTING = {
  CONNECT: OPENING,
  RECONNECT: OPENING,
  CLOSE: CLOSED,
  'PAGE_RESUMED(kept talking)': OPENING,
  'PAGE_RESUMED(went quiet)': OPENING,
}

/** Every move that leaves a state or announces something. An event not listed changes nothing and says nothing. */
const MOVES: Record<keyof typeof REACH, Record<string, Move>> = {
  idle: { CONNECT: OPENING, RECONNECT: OPENING, CLOSE: CLOSED },
  closed: { CONNECT: OPENING, RECONNECT: OPENING, CLOSE: CLOSED },
  'active.opening': {
    CLOSE: CLOSED,
    PREPARED: ['active.connected.dialing'],
    PREPARE_FAILED: RECONNECTING,
  },
  'active.connected.dialing': {
    RECONNECT: OPENING,
    CLOSE: CLOSED,
    SOCKET_REFUSED: RECONNECTING,
    SOCKET_OPENED: ['active.connected.greeting'],
    HELLO: ['active.connected.open', 'open'],
    GREETING_FOREIGN: RECONNECTING,
    'SOCKET_CLOSED(1006)': RECONNECTING,
    'SOCKET_CLOSED(4426)': OUTDATED,
    'PAGE_RESUMED(kept talking)': OPENING,
    'PAGE_RESUMED(went quiet)': OPENING,
    DIAL_DUE: RECONNECTING,
  },
  'active.connected.greeting': {
    RECONNECT: OPENING,
    CLOSE: CLOSED,
    HELLO: ['active.connected.open', 'open'],
    GREETING_FOREIGN: RECONNECTING,
    'SOCKET_CLOSED(1006)': RECONNECTING,
    'SOCKET_CLOSED(4426)': OUTDATED,
    HELLO_TIMED_OUT: RECONNECTING,
    'HELLO_TIMED_OUT(page away)': RECONNECTING,
    'PAGE_RESUMED(kept talking)': OPENING,
    'PAGE_RESUMED(went quiet)': OPENING,
  },
  'active.connected.open': {
    RECONNECT: OPENING,
    CLOSE: CLOSED,
    FRAME_UNREADABLE: OUTDATED,
    'SOCKET_CLOSED(1006)': RECONNECTING,
    'SOCKET_CLOSED(4426)': OUTDATED,
    WATCHDOG_EXPIRED: RECONNECTING,
    'WATCHDOG_EXPIRED(page away)': RECONNECTING,
    'PAGE_RESUMED(went quiet)': OPENING,
  },
  // A suspend on a page that is still visible and online (the table's page) is no failed attempt.
  'active.reconnecting': { ...RESTING, RUNG_DUE: OPENING },
  'active.suspended': { ...RESTING, PAGE_SUSPENDED: ['active.suspended', 'suspended'] },
  'active.offline': { ...RESTING, PAGE_SUSPENDED: ['active.offline', 'offline'] },
  'active.failed': RESTING,
  'active.incompatible': RESTING,
  'active.outdated': { CONNECT: OPENING, RECONNECT: OPENING, CLOSE: CLOSED },
}

describe('every state, every event', () => {
  it('reaches every resting state the chart declares, and the table names no other', () => {
    const declared = (node: { key: string; states: Record<string, unknown> }, prefix = ''): string[] =>
      Object.values(node.states as Record<string, { key: string; states: Record<string, unknown> }>).flatMap(
        (child) => {
          const path = `${prefix}${child.key}`
          return Object.keys(child.states).length === 0 ? [path] : declared(child, `${path}.`)
        }
      )
    // `retry` rests nowhere: it decides and moves on in the same step.
    const resting = declared(turnSocketMachine.root).filter((path) => path !== 'active.retry')
    expect(Object.keys(REACH).toSorted()).toEqual(resting.toSorted())
    for (const [state, { events, ladder, page }] of Object.entries(REACH)) {
      expect(walk(events, ladder, page).state, state).toBe(state)
    }
  })

  it('declares no event the table leaves out', () => {
    const declared = new Set<string>()
    const collect = (node: { ownEvents: string[]; states: Record<string, unknown> }): void => {
      for (const event of node.ownEvents) declared.add(event)
      for (const child of Object.values(node.states)) collect(child as Parameters<typeof collect>[0])
    }
    collect(turnSocketMachine.root)
    const walked = new Set(Object.values(EVENTS).map((event) => event.type))
    expect([...declared].filter((event) => event !== '' && !walked.has(event as TurnSocketEvent['type']))).toEqual([])
  })

  for (const [state, { events, ladder, page }] of Object.entries(REACH)) {
    for (const [name, event] of Object.entries(EVENTS)) {
      const [target, ...announced] = MOVES[state][name] ?? [state]
      it(`${state} on ${name}: ${target === state && announced.length === 0 ? 'nothing' : [target, ...announced].join(', ')}`, () => {
        const before = walk(events, ladder, page)
        const after = walk([event], ladder, page, before.snapshot)
        expect(after.state).toBe(target)
        expect(after.announced).toEqual(announced)
      })
    }
  }
})

describe('the ladder', () => {
  const failOnce: TurnSocketEvent[] = [PREPARED, DROPPED, RUNG_DUE]

  it('takes one rung per failed attempt, gives up as failed when none is left, and says reconnecting first', () => {
    const run = walk([{ type: 'CONNECT' }, ...failOnce, ...failOnce, PREPARED, DROPPED], { delaysMs: [10, 20] }, HERE)
    expect(run.state).toBe('active.failed')
    expect(run.announced).toEqual([
      'connecting',
      'reconnecting',
      'connecting',
      'reconnecting',
      'connecting',
      'reconnecting',
      'failed',
    ])
    expect(run.snapshot.context.attempts).toBe(2)
  })

  it('gives up as incompatible when the last attempt reached a server in another dialect', () => {
    const run = walk(
      [{ type: 'CONNECT' }, PREPARED, { type: 'SOCKET_OPENED' }, { type: 'HELLO_TIMED_OUT', pageWasAway: false }],
      { delaysMs: [] },
      HERE
    )
    expect(run.state).toBe('active.incompatible')
    expect(run.announced).toEqual(['connecting', 'reconnecting', 'incompatible'])
  })

  it('blames the network again once a later attempt is made: each attempt starts as failed', () => {
    const run = walk(
      [{ type: 'CONNECT' }, PREPARED, { type: 'GREETING_FOREIGN' }, RUNG_DUE, PREPARED, DROPPED],
      { delaysMs: [10] },
      HERE
    )
    expect(run.state).toBe('active.failed')
  })

  it('does not blame the dialect for a hello a frozen page kept from arriving', () => {
    const run = walk(
      [{ type: 'CONNECT' }, PREPARED, { type: 'SOCKET_OPENED' }, { type: 'HELLO_TIMED_OUT', pageWasAway: true }],
      { delaysMs: [] },
      HERE
    )
    expect(run.state).toBe('active.failed')
  })

  it('takes a rung for a dial nobody answered, gives up as failed, and rests suspended on a hidden page', () => {
    const hung = walk([...TO_DIALING, DIAL_DUE], { delaysMs: [10] }, HERE)
    expect(hung.state).toBe('active.reconnecting')
    expect(hung.snapshot.context.attempts).toBe(1)
    expect(hung.actions).toContain('dropSocket')
    const spent = walk([...TO_DIALING, DIAL_DUE], { delaysMs: [] }, HERE)
    expect(spent.state).toBe('active.failed')
    expect(spent.announced).toEqual(['connecting', 'reconnecting', 'failed'])
    const away = walk([...TO_DIALING, DIAL_DUE], { delaysMs: [10] }, HIDDEN)
    expect(away.state).toBe('active.suspended')
    expect(away.snapshot.context.attempts).toBe(0)
  })

  it('takes a rung for a preparation that failed and for a socket that could not be made, and gives up as failed', () => {
    const unprepared = walk([{ type: 'CONNECT' }, { type: 'PREPARE_FAILED' }], { delaysMs: [10] }, HERE)
    expect(unprepared.state).toBe('active.reconnecting')
    expect(unprepared.snapshot.context.attempts).toBe(1)
    expect(unprepared.snapshot.context.preparing).toBe(false)

    const again = walk([RUNG_DUE, PREPARED, { type: 'SOCKET_REFUSED' }], { delaysMs: [10] }, HERE, unprepared.snapshot)
    expect(again.state).toBe('active.failed')
    expect(again.announced).toEqual(['connecting', 'reconnecting', 'failed'])
  })

  it('does not blame the dialect when the attempt after a foreign greeting could not even be prepared', () => {
    const run = walk(
      [{ type: 'CONNECT' }, PREPARED, { type: 'GREETING_FOREIGN' }, RUNG_DUE, { type: 'PREPARE_FAILED' }],
      { delaysMs: [10] },
      HERE
    )
    expect(run.state).toBe('active.failed')
  })

  it('starts over on the hello, the evidence that it works', () => {
    const run = walk([{ type: 'CONNECT' }, ...failOnce, PREPARED, { type: 'HELLO' }], { delaysMs: [10, 20] }, HERE)
    expect(run.snapshot.context.attempts).toBe(0)
  })

  it('gives a connect after giving up a new ladder, and leaves a ladder with rungs where it is', () => {
    const spent = walk([{ type: 'CONNECT' }, ...failOnce, PREPARED, DROPPED], { delaysMs: [10] }, HERE)
    expect(spent.state).toBe('active.failed')
    expect(walk([{ type: 'CONNECT' }], { delaysMs: [10] }, HERE, spent.snapshot).snapshot.context.attempts).toBe(0)

    const midway = walk([{ type: 'CONNECT' }, PREPARED, DROPPED], { delaysMs: [10, 20] }, HERE)
    expect(walk([{ type: 'CONNECT' }], { delaysMs: [10, 20] }, HERE, midway.snapshot).snapshot.context.attempts).toBe(1)
    expect(walk([{ type: 'RECONNECT' }], { delaysMs: [10, 20] }, HERE, midway.snapshot).snapshot.context.attempts).toBe(0)
  })

  it('agrees with createRetryLadder on which rungs exist and how long each waits', () => {
    const ladders: RetryLadderOptions[] = [
      { delaysMs: [] },
      { delaysMs: [100, 250, 0] },
      { baseMs: 1_000, maxMs: 30_000, budget: 3, random: () => 0.5 },
      { baseMs: 500, maxMs: 2_000, random: () => 1 },
    ]
    vi.useFakeTimers()
    try {
      for (const options of ladders) {
        const oracle = createRetryLadder(options)
        for (let index = 0; index < 6; index += 1) {
          expect(hasRung(options, index)).toBe(!oracle.spent)
          if (oracle.spent) break
          const fired = vi.fn()
          oracle.schedule(fired)
          const delay = rungDelayMs(options, index)
          if (delay > 0) {
            vi.advanceTimersByTime(delay - 1)
            expect(fired).not.toHaveBeenCalled()
          }
          vi.advanceTimersByTime(1)
          expect(fired).toHaveBeenCalledOnce()
        }
      }
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('a page away', () => {
  it('spends no rung while offline, and opens from the first rung when the page is back', () => {
    const page = { hidden: false, offline: true }
    const away = walk([...TO_OPEN, DROPPED], { delaysMs: [10] }, page)
    expect(away.state).toBe('active.offline')
    expect(away.snapshot.context.attempts).toBe(0)

    page.offline = false
    const back = walk([{ type: 'PAGE_RESUMED', socketWentQuiet: false }], { delaysMs: [10] }, page, away.snapshot)
    expect(back.state).toBe('active.opening')
    expect(back.announced).toEqual(['connecting'])
  })

  it('moves a waiting rung to suspended when the tab is hidden, and reopens when it is visible again', () => {
    const page = { hidden: false, offline: false }
    const waiting = walk([...TO_OPEN, DROPPED], { delaysMs: [10] }, page)
    expect(waiting.state).toBe('active.reconnecting')

    page.hidden = true
    const hidden = walk([{ type: 'PAGE_SUSPENDED' }], { delaysMs: [10] }, page, waiting.snapshot)
    expect(hidden.state).toBe('active.suspended')
    // The rung that was waiting is cancelled with the state it belonged to.
    expect(hidden.actions).toContain('xstate.cancel')

    page.hidden = false
    const visible = walk([{ type: 'PAGE_RESUMED', socketWentQuiet: false }], { delaysMs: [10] }, page, hidden.snapshot)
    expect(visible.state).toBe('active.opening')
    expect(visible.snapshot.context.attempts).toBe(0)
  })

  it('tries nothing when a rung falls due on a page gone away since: hidden wins over offline', () => {
    const page = { hidden: false, offline: false }
    const waiting = walk([...TO_OPEN, DROPPED], { delaysMs: [10] }, page)
    page.offline = true
    expect(walk([RUNG_DUE], { delaysMs: [10] }, page, waiting.snapshot).state).toBe('active.offline')
    page.hidden = true
    expect(walk([RUNG_DUE], { delaysMs: [10] }, page, waiting.snapshot).state).toBe('active.suspended')
  })

  it('takes a suspend on a page still visible and online for nothing: no rung, and a failure is not said twice', () => {
    const waiting = walk([...TO_OPEN, DROPPED], { delaysMs: [10, 20] }, HERE)
    const nudged = walk([{ type: 'PAGE_SUSPENDED' }], { delaysMs: [10, 20] }, HERE, waiting.snapshot)
    expect(nudged.state).toBe('active.reconnecting')
    expect(nudged.announced).toEqual([])
    expect(nudged.snapshot.context.attempts).toBe(1)
    // The rung that is waiting still falls due.
    expect(nudged.actions).not.toContain('xstate.cancel')

    const spent = walk([...TO_DIALING, DROPPED], { delaysMs: [] }, HERE)
    expect(walk([{ type: 'PAGE_SUSPENDED' }], { delaysMs: [] }, HERE, spent.snapshot).announced).toEqual([])
  })

  it('keeps an open socket through it, and an attempt that is preparing', () => {
    const open = walk(TO_OPEN, { delaysMs: [10] }, HIDDEN)
    expect(walk([{ type: 'PAGE_SUSPENDED' }], { delaysMs: [10] }, HIDDEN, open.snapshot).state).toBe(
      'active.connected.open'
    )
    const opening = walk([{ type: 'CONNECT' }], { delaysMs: [10] }, HIDDEN)
    expect(walk([{ type: 'PAGE_SUSPENDED' }], { delaysMs: [10] }, HIDDEN, opening.snapshot).announced).toEqual([])
  })
})

describe('what the chart asks of its driver, and in which order', () => {
  it('drops the socket before it announces what comes next', () => {
    const open = walk(TO_OPEN, { delaysMs: [10] }, HERE)
    const closed = walk([{ type: 'CLOSE' }], { delaysMs: [10] }, HERE, open.snapshot)
    expect(closed.actions.indexOf('dropSocket')).toBeLessThan(closed.actions.indexOf('announce'))
    const outdated = walk([{ type: 'FRAME_UNREADABLE' }], { delaysMs: [10] }, HERE, open.snapshot)
    expect(outdated.actions.indexOf('dropSocket')).toBeLessThan(outdated.actions.indexOf('announce'))
  })

  it('names the silent turns after the drop and before the status, and not at all for a page that was away', () => {
    const open = walk(TO_OPEN, { delaysMs: [10] }, HERE)
    const silent = walk(
      [{ type: 'WATCHDOG_EXPIRED', turnIds: ['t1'], pageWasAway: false }],
      { delaysMs: [10] },
      HERE,
      open.snapshot
    )
    expect(silent.actions.filter((type) => !type.startsWith('xstate.'))).toEqual([
      'dropSocket',
      'reportSilence',
      'announce',
    ])
    const frozen = walk(
      [{ type: 'WATCHDOG_EXPIRED', turnIds: ['t1'], pageWasAway: true }],
      { delaysMs: [10] },
      HERE,
      open.snapshot
    )
    expect(frozen.actions).not.toContain('reportSilence')
  })

  it('announces open before it attaches the open turns', () => {
    const run = walk(TO_OPEN, { delaysMs: [10] }, HERE)
    expect(run.actions.slice(-3, -1)).toEqual(['announce', 'attachOpenTurns'])
  })

  it('adopts a preparation still in flight when a connect follows a close: one prepare, one connecting', () => {
    const run = walk([{ type: 'CONNECT' }, { type: 'CLOSE' }, { type: 'CONNECT' }, PREPARED], { delaysMs: [10] }, HERE)
    expect(run.announced).toEqual(['connecting', 'closed'])
    expect(run.actions.filter((type) => type === 'prepare')).toHaveLength(1)
    expect(run.state).toBe('active.connected.dialing')
  })

  it('opens nothing for a preparation that finishes after the close, and prepares afresh on the next connect', () => {
    const run = walk([{ type: 'CONNECT' }, { type: 'CLOSE' }, PREPARED], { delaysMs: [10] }, HERE)
    expect(run.state).toBe('closed')
    const again = walk([{ type: 'CONNECT' }], { delaysMs: [10] }, HERE, run.snapshot)
    expect(again.announced).toEqual(['connecting'])
    expect(again.actions).toContain('prepare')
  })
})

describe('run as an actor, with fake actors', () => {
  /** Each provided actor, recording when the chart starts and stops it. */
  const harness = (ladder: RetryLadderOptions, page: Page = { hidden: false, offline: false }) => {
    const log: string[] = []
    const recorded = <TInput = unknown>(name: string, describe: (input: TInput) => string = () => '') =>
      fromCallback<TurnSocketEvent, TInput>(({ input }) => {
        log.push(`start ${name}${describe(input)}`)
        return () => log.push(`stop ${name}`)
      })
    const actor = createActor(
      turnSocketMachine.provide({
        actors: {
          page: recorded('page'),
          socket: recorded<{ url: string }>('socket', (input) => ` ${input.url}`),
          helloTimer: recorded('helloTimer'),
          silenceWatch: recorded('silenceWatch'),
        },
        actions: {
          announce: (_, { status }) => log.push(status),
          prepare: () => log.push('prepare'),
          dropSocket: () => log.push('drop'),
          attachOpenTurns: () => log.push('attach'),
          reportSilence: (_, { turnIds }) => log.push(`silent ${turnIds.join(',')}`),
        },
        guards: { pageHidden: () => page.hidden, pageOffline: () => page.offline },
      }),
      { input: { ladder } }
    )
    actor.start()
    const since = (): string[] => log.splice(0)
    const state = (): string => pathOf(actor.getSnapshot().value)
    return { actor, since, state, page }
  }

  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does nothing until it is asked to connect', () => {
    const { since, state } = harness({ delaysMs: [100] })
    expect(state()).toBe('idle')
    expect(since()).toEqual([])
  })

  it('runs one attempt: the page, the preparation, the socket, the hello timer, the watchdog', () => {
    const { actor, since } = harness({ delaysMs: [100] })
    actor.send({ type: 'CONNECT' })
    expect(since()).toEqual(['connecting', 'prepare', 'start page'])
    actor.send(PREPARED)
    expect(since()).toEqual(['start socket ws://test'])
    actor.send({ type: 'SOCKET_OPENED' })
    expect(since()).toEqual(['start helloTimer'])
    actor.send({ type: 'HELLO' })
    expect(since()).toEqual(['open', 'attach', 'stop helloTimer', 'start silenceWatch'])
  })

  it('waits each rung of the ladder out, then gives up and waits for nothing more', () => {
    const { actor, since, state } = harness({ delaysMs: [100, 300] })
    actor.send({ type: 'CONNECT' })
    actor.send(PREPARED)
    since()

    actor.send(DROPPED)
    expect(since()).toEqual(['drop', 'reconnecting', 'stop socket'])
    vi.advanceTimersByTime(99)
    expect(state()).toBe('active.reconnecting')
    vi.advanceTimersByTime(1)
    expect(since()).toEqual(['connecting', 'prepare'])

    actor.send(PREPARED)
    actor.send(DROPPED)
    since()
    vi.advanceTimersByTime(299)
    expect(state()).toBe('active.reconnecting')
    vi.advanceTimersByTime(1)
    expect(state()).toBe('active.opening')

    actor.send(PREPARED)
    actor.send(DROPPED)
    expect(state()).toBe('active.failed')
    since()
    vi.advanceTimersByTime(600_000)
    expect(since()).toEqual([])
  })

  it('stops the hello timer and the socket when no hello came, and tries again', () => {
    const { actor, since, state } = harness({ delaysMs: [100] })
    actor.send({ type: 'CONNECT' })
    actor.send(PREPARED)
    actor.send({ type: 'SOCKET_OPENED' })
    since()
    actor.send({ type: 'HELLO_TIMED_OUT', pageWasAway: false })
    expect(since()).toEqual(['drop', 'reconnecting', 'stop helloTimer', 'stop socket'])
    expect(actor.getSnapshot().context.lastFailure).toBe('incompatible')
    vi.advanceTimersByTime(100)
    expect(state()).toBe('active.opening')
  })

  it('cancels the waiting rung when the tab is hidden, and reopens at once when it is visible again', () => {
    const { actor, since, state, page } = harness({ delaysMs: [100] })
    actor.send({ type: 'CONNECT' })
    actor.send(PREPARED)
    actor.send(DROPPED)
    page.hidden = true
    actor.send({ type: 'PAGE_SUSPENDED' })
    since()
    vi.advanceTimersByTime(600_000)
    expect(state()).toBe('active.suspended')
    expect(since()).toEqual([])

    page.hidden = false
    actor.send({ type: 'PAGE_RESUMED', socketWentQuiet: false })
    expect(since()).toEqual(['connecting', 'prepare'])
  })

  it('goes offline instead of spending a rung, and comes back', () => {
    const { actor, since, state, page } = harness({ delaysMs: [100] })
    actor.send({ type: 'CONNECT' })
    actor.send(PREPARED)
    actor.send({ type: 'HELLO' })
    page.offline = true
    actor.send({ type: 'PAGE_SUSPENDED' })
    expect(state()).toBe('active.connected.open')
    since()
    actor.send(DROPPED)
    expect(since()).toEqual(['drop', 'offline', 'stop silenceWatch', 'stop socket'])

    page.offline = false
    actor.send({ type: 'PAGE_RESUMED', socketWentQuiet: false })
    expect(state()).toBe('active.opening')
  })

  it('stops for good on an outdated close, and keeps listening to nothing the page says', () => {
    const { actor, since, state } = harness({ delaysMs: [100] })
    actor.send({ type: 'CONNECT' })
    actor.send(PREPARED)
    actor.send({ type: 'HELLO' })
    since()
    actor.send(REFUSED_AS_OUTDATED)
    expect(since()).toEqual(['drop', 'outdated', 'stop silenceWatch', 'stop socket'])
    actor.send({ type: 'PAGE_RESUMED', socketWentQuiet: true })
    vi.advanceTimersByTime(600_000)
    expect(state()).toBe('active.outdated')
    expect(since()).toEqual([])
  })

  it('closes from every state: closed is announced last, every actor is stopped, and no timer is left', () => {
    for (const [name, { events, ladder, page }] of Object.entries(REACH)) {
      const { actor, since, state } = harness(ladder, { ...page })
      for (const event of events) actor.send(event)
      const started = since().filter((entry) => entry.startsWith('start '))
      actor.send({ type: 'CLOSE' })
      const closing = since()
      expect(state(), name).toBe('closed')
      expect(closing.filter((entry) => !entry.startsWith('stop ') && entry !== 'drop'), name).toEqual(['closed'])
      // Whatever was started and had not been stopped before the close is stopped by it.
      const running = new Set(started.map((entry) => entry.split(' ')[1]))
      for (const stopped of closing.filter((entry) => entry.startsWith('stop '))) {
        expect(running.has(stopped.split(' ')[1]), `${name}: ${stopped}`).toBe(true)
      }
      if (name.startsWith('active.')) expect(closing, name).toContain('stop page')
      vi.advanceTimersByTime(600_000)
      expect(since(), name).toEqual([])
      expect(vi.getTimerCount(), name).toBe(0)
    }
  })

  it('subscribes to the page once for as long as it is active, across reconnects', () => {
    const { actor, since } = harness({ delaysMs: [100] })
    actor.send({ type: 'CONNECT' })
    actor.send(PREPARED)
    actor.send({ type: 'HELLO' })
    actor.send({ type: 'RECONNECT' })
    actor.send(PREPARED)
    actor.send(DROPPED)
    actor.send({ type: 'CONNECT' })
    const log = since()
    expect(log.filter((entry) => entry === 'start page')).toHaveLength(1)
    expect(log).not.toContain('stop page')
  })
})
