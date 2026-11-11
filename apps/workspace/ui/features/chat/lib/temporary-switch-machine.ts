/**
 * The temporary switch of one conversation as a statechart (ADR-0180 rule 2,
 * ADR-0179): every place the switch can be in, and every move between them.
 *
 * The rule it holds: the screen never says "keeps nothing" while the server
 * row still keeps. What the server holds is `confirmed`; what the person last
 * asked for is `wanted`. A chat without a row is a draft: its create carries
 * `wanted`, so the create's answer is the confirmation. A switch made while the
 * create is in flight is said to the server once the row exists, and until it
 * is confirmed the switch is pending and a turn waits (`sendBlocked`).
 *
 * Pure: no store, no fetch. The PATCH is the `save` actor, provided by
 * `temporary-conversation.ts`; the spec provides a fake.
 */

import { assign, fromPromise, setup, type SnapshotFrom } from 'xstate'

export interface TemporarySwitchContext {
  /** What the server row holds; for a draft, what its create will carry. */
  confirmed: boolean
  /** The person's last word. */
  wanted: boolean
  /** What the create in flight carries, while one is. */
  carried: boolean
  /** Whether the server held the row when the switch was first read. */
  onServer: boolean
}

export type TemporarySwitchEvent =
  /** The person switched. */
  | { type: 'toggle'; temporary: boolean }
  /** The create left with this flag. */
  | { type: 'create.started'; temporary: boolean }
  /** The row exists; the server answered this flag. */
  | { type: 'row.created'; temporary: boolean }
  /** The create failed; the chat is still a draft. */
  | { type: 'create.failed' }
  /** The server's row as a list load reports it (another tab may have switched). */
  | { type: 'row.reported'; temporary: boolean }

export interface TemporarySwitchInput {
  /** Whether the server holds the row. */
  onServer: boolean
  /** The row's flag, or for a draft the flag its create will carry. */
  temporary: boolean
}

export const temporarySwitchMachine = setup({
  types: {
    context: {} as TemporarySwitchContext,
    events: {} as TemporarySwitchEvent,
    input: {} as TemporarySwitchInput,
  },
  actors: {
    /** Says the flag to the server; resolves with the row's flag as the server answered it. */
    save: fromPromise<boolean, { temporary: boolean }>(async ({ input }) => input.temporary),
  },
  actions: {
    /** The server refused or failed: the screen shows what it holds, and the person is told. */
    notifyRefused: (_, _params: { error: unknown }) => {},
  },
  guards: {
    wantsOn: ({ event }) => 'temporary' in event && event.temporary,
    wantsOff: ({ event }) => 'temporary' in event && !event.temporary,
    confirmedOn: ({ context }) => context.confirmed,
    rowAsWanted: ({ context, event }) => event.type === 'row.created' && event.temporary === context.wanted,
  },
}).createMachine({
  id: 'temporarySwitch',
  context: ({ input }) => ({
    confirmed: input.temporary,
    wanted: input.temporary,
    carried: input.temporary,
    onServer: input.onServer,
  }),
  initial: 'starting',
  states: {
    /** Where a switch begins: a draft for a chat the server does not hold, else what its row says. */
    starting: {
      always: [{ guard: ({ context }) => !context.onServer, target: 'draft' }, { target: 'settled' }],
    },
    /** No row and no create yet: the switch is free, the create will carry it. */
    draft: {
      on: {
        toggle: { actions: assign(({ event }) => ({ wanted: event.temporary, confirmed: event.temporary })) },
        'create.started': {
          target: 'creating',
          actions: assign(({ event }) => ({ carried: event.temporary })),
        },
      },
    },
    /** The create is in flight with `carried`; a switch now has to wait for the row. */
    creating: {
      on: {
        toggle: { actions: assign(({ event }) => ({ wanted: event.temporary })) },
        'row.created': [
          {
            guard: 'rowAsWanted',
            target: 'settled',
            actions: assign(({ event }) => ({ confirmed: event.temporary })),
          },
          // The row came back without the person's last word: say it to the server now.
          {
            guard: 'wantsOff',
            target: 'turningOn',
            actions: assign(({ event }) => ({ confirmed: event.temporary })),
          },
          { target: 'turningOff', actions: assign(({ event }) => ({ confirmed: event.temporary })) },
        ],
        'create.failed': {
          target: 'draft',
          actions: assign(({ context }) => ({ confirmed: context.wanted })),
        },
      },
    },
    /** Resolves to `on` or `off` from what the server holds. */
    settled: {
      always: [{ guard: 'confirmedOn', target: 'on' }, { target: 'off' }],
    },
    off: {
      on: {
        toggle: { guard: 'wantsOn', target: 'turningOn', actions: assign({ wanted: true }) },
        'row.reported': {
          guard: 'wantsOn',
          target: 'on',
          actions: assign({ confirmed: true, wanted: true }),
        },
      },
    },
    on: {
      on: {
        toggle: { guard: 'wantsOff', target: 'turningOff', actions: assign({ wanted: false }) },
        'row.reported': {
          guard: 'wantsOff',
          target: 'off',
          actions: assign({ confirmed: false, wanted: false }),
        },
      },
    },
    turningOn: {
      invoke: {
        src: 'save',
        input: { temporary: true },
        onDone: {
          target: 'settled',
          actions: assign(({ event }) => ({ confirmed: event.output, wanted: event.output })),
        },
        onError: {
          target: 'failed',
          actions: { type: 'notifyRefused', params: ({ event }) => ({ error: event.error }) },
        },
      },
    },
    turningOff: {
      invoke: {
        src: 'save',
        input: { temporary: false },
        onDone: {
          target: 'settled',
          actions: assign(({ event }) => ({ confirmed: event.output, wanted: event.output })),
        },
        onError: {
          target: 'failed',
          actions: { type: 'notifyRefused', params: ({ event }) => ({ error: event.error }) },
        },
      },
    },
    /** The last switch did not reach the server: what it holds stands, and switching again is a new try. */
    failed: {
      entry: assign(({ context }) => ({ wanted: context.confirmed })),
      on: {
        toggle: [
          { guard: ({ context, event }) => event.temporary === context.confirmed, target: 'settled' },
          { guard: 'wantsOn', target: 'turningOn', actions: assign({ wanted: true }) },
          { target: 'turningOff', actions: assign({ wanted: false }) },
        ],
        'row.reported': {
          target: 'settled',
          actions: assign(({ event }) => ({ confirmed: event.temporary, wanted: event.temporary })),
        },
      },
    },
  },
})

export type TemporarySwitchSnapshot = SnapshotFrom<typeof temporarySwitchMachine>

/** What the toggle and the line under the composer show. */
export interface TemporarySwitchView {
  /** The toggle's state: the person's last word. */
  pressed: boolean
  /** A switch is on its way to the server: the toggle waits. */
  pending: boolean
  /** The line under the composer: what holds, or what is being switched. */
  statement: 'temporary' | 'turningOn' | 'turningOff' | null
  /** A turn must wait: the person's word and the server's differ. */
  sendBlocked: boolean
}

export function viewOf(snapshot: TemporarySwitchSnapshot): TemporarySwitchView {
  const { confirmed, wanted, carried } = snapshot.context
  if (snapshot.matches('creating')) {
    const differs = wanted !== carried
    return {
      pressed: wanted,
      pending: false,
      statement: differs ? (wanted ? 'turningOn' : 'turningOff') : wanted ? 'temporary' : null,
      sendBlocked: differs,
    }
  }
  if (snapshot.matches('turningOn')) return { pressed: true, pending: true, statement: 'turningOn', sendBlocked: true }
  if (snapshot.matches('turningOff')) return { pressed: false, pending: true, statement: 'turningOff', sendBlocked: true }
  // draft (the create will carry it), on, off, failed: what the server holds or will be created with.
  return { pressed: confirmed, pending: false, statement: confirmed ? 'temporary' : null, sendBlocked: false }
}
