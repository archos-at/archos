import { assign, fromPromise, setup, type SnapshotFrom } from 'xstate'

export interface TemporarySwitchContext {
  confirmed: boolean
  wanted: boolean
  carried: boolean
  onServer: boolean
}

export type TemporarySwitchEvent =
  | { type: 'toggle'; temporary: boolean }
  | { type: 'create.started'; temporary: boolean }
  | { type: 'row.created'; temporary: boolean }
  | { type: 'create.failed' }
  | { type: 'row.reported'; temporary: boolean }

export interface TemporarySwitchInput {
  onServer: boolean
  temporary: boolean
}

export const temporarySwitchMachine = setup({
  types: {
    context: {} as TemporarySwitchContext,
    events: {} as TemporarySwitchEvent,
    input: {} as TemporarySwitchInput,
  },
  actors: {
    save: fromPromise<boolean, { temporary: boolean }>(async ({ input }) => input.temporary),
  },
  actions: {
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
    starting: {
      always: [{ guard: ({ context }) => !context.onServer, target: 'draft' }, { target: 'settled' }],
    },
    draft: {
      on: {
        toggle: { actions: assign(({ event }) => ({ wanted: event.temporary, confirmed: event.temporary })) },
        'create.started': {
          target: 'creating',
          actions: assign(({ event }) => ({ carried: event.temporary })),
        },
      },
    },
    creating: {
      on: {
        toggle: { actions: assign(({ event }) => ({ wanted: event.temporary })) },
        'row.created': [
          {
            guard: 'rowAsWanted',
            target: 'settled',
            actions: assign(({ event }) => ({ confirmed: event.temporary })),
          },
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

export interface TemporarySwitchView {
  pressed: boolean
  pending: boolean
  statement: 'temporary' | 'turningOn' | 'turningOff' | null
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
  return { pressed: confirmed, pending: false, statement: confirmed ? 'temporary' : null, sendBlocked: false }
}
