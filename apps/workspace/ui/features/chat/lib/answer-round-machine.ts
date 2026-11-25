import { assign, setup, type SnapshotFrom } from 'xstate'

export interface AnswerRoundInput {
  fadeMs: number
  returnMs: number
}

export interface AnswerRoundContext extends AnswerRoundInput {
  reopened: boolean
}

export type AnswerRoundEvent = { type: 'retract' } | { type: 'resume' }

export const answerRoundMachine = setup({
  types: {
    context: {} as AnswerRoundContext,
    events: {} as AnswerRoundEvent,
    input: {} as AnswerRoundInput,
  },
  delays: {
    fade: ({ context }) => context.fadeMs,
    return: ({ context }) => context.returnMs,
  },
}).createMachine({
  id: 'answerRound',
  context: ({ input }) => ({ ...input, reopened: false }),
  initial: 'writing',
  states: {
    writing: {
      on: { retract: 'retracting' },
    },
    retracting: {
      initial: 'fading',
      states: {
        fading: {
          after: { fade: 'quiet' },
          on: { resume: '#answerRound.writing' },
        },
        quiet: {
          on: { resume: '#answerRound.returning' },
        },
      },
    },
    returning: {
      entry: assign({ reopened: true }),
      after: { return: 'writing' },
      on: { retract: 'retracting' },
    },
  },
})

export type AnswerRoundSnapshot = SnapshotFrom<typeof answerRoundMachine>

export const roundIsQuiet = (snapshot: AnswerRoundSnapshot): boolean => snapshot.matches({ retracting: 'quiet' })

export const roundIsReturning = (snapshot: AnswerRoundSnapshot): boolean => snapshot.matches('returning')

export const roundReopened = (snapshot: AnswerRoundSnapshot): boolean => snapshot.context.reopened
