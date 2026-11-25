import { describe, expect, test } from 'vitest'
import { createActor } from 'xstate'
import { answerFooterMachine, openPanel, type AnswerFooterEvent } from './answer-footer-machine'

const run = (...events: AnswerFooterEvent[]) => {
  const actor = createActor(answerFooterMachine).start()
  events.forEach((event) => actor.send(event))
  return openPanel(actor.getSnapshot())
}

describe('answer footer drawer', () => {
  test('starts shut', () => {
    expect(run()).toBeNull()
  })

  test('a trigger opens its panel and the same trigger shuts it', () => {
    expect(run({ type: 'toggle', panel: 'details' })).toBe('details')
    expect(run({ type: 'toggle', panel: 'details' }, { type: 'toggle', panel: 'details' })).toBeNull()
  })

  test('holds one panel at a time: another trigger swaps it', () => {
    expect(run({ type: 'toggle', panel: 'sources' }, { type: 'toggle', panel: 'details' })).toBe('details')
    expect(run({ type: 'toggle', panel: 'details' }, { type: 'open', panel: 'reasons' })).toBe('reasons')
  })

  test('closing a panel that is not shown leaves the shown one alone', () => {
    expect(run({ type: 'toggle', panel: 'sources' }, { type: 'close', panel: 'reasons' })).toBe('sources')
  })

  test('closing the shown panel shuts the drawer', () => {
    expect(run({ type: 'open', panel: 'reasons' }, { type: 'close', panel: 'reasons' })).toBeNull()
  })

  test('Escape shuts whatever is open', () => {
    expect(run({ type: 'toggle', panel: 'sources' }, { type: 'escape' })).toBeNull()
  })
})
