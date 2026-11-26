import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createActor } from 'xstate'

import { answerRoundMachine, roundIsQuiet, roundIsReturning, roundReopened } from './answer-round-machine'

const start = (fadeMs = 180, returnMs = 240) => createActor(answerRoundMachine, { input: { fadeMs, returnMs } }).start()

describe('answerRoundMachine', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fades a retracted round out, then holds the quiet line', () => {
    const round = start()
    round.send({ type: 'retract' })
    expect(round.getSnapshot().matches({ retracting: 'fading' })).toBe(true)
    vi.advanceTimersByTime(180)
    expect(roundIsQuiet(round.getSnapshot())).toBe(true)
  })

  it('lets the next round fade back in from the quiet line, then writes', () => {
    const round = start()
    round.send({ type: 'retract' })
    vi.advanceTimersByTime(180)
    round.send({ type: 'resume' })
    expect(roundIsReturning(round.getSnapshot())).toBe(true)
    vi.advanceTimersByTime(240)
    expect(round.getSnapshot().matches('writing')).toBe(true)
    expect(roundReopened(round.getSnapshot())).toBe(true)
  })

  it('counts a first round as not reopened', () => {
    expect(roundReopened(start().getSnapshot())).toBe(false)
  })

  it('returns straight to writing when the round resumes before the old words faded', () => {
    const round = start()
    round.send({ type: 'retract' })
    vi.advanceTimersByTime(60)
    round.send({ type: 'resume' })
    expect(round.getSnapshot().matches('writing')).toBe(true)
  })

  it('retracts again while the new round is still fading in', () => {
    const round = start()
    round.send({ type: 'retract' })
    vi.advanceTimersByTime(180)
    round.send({ type: 'resume' })
    round.send({ type: 'retract' })
    expect(round.getSnapshot().matches({ retracting: 'fading' })).toBe(true)
  })
})
