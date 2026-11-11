import { describe, expect, it } from 'vitest'
import { createMachine, initialTransition, transition } from 'xstate'
import { defineLifecycle, type Lifecycle } from './define-lifecycle'
import { lifecycleDiagram } from './lifecycle-diagram'

const door = defineLifecycle({
  id: 'door',
  initial: 'closed',
  bornAs: ['open'],
  states: {
    closed: { on: { open: 'open', lock: 'locked', remove: 'removed' } },
    open: { on: { close: 'closed', remove: 'removed' } },
    locked: { on: { unlock: 'closed' } },
    removed: { type: 'final' },
  },
})

/**
 * XState's interpreter is the oracle (AGENTS.md, „Buy, don't build"): the
 * helper is ours because a row's state lives in the database and a move is an
 * UPDATE, but what a statechart means is not ours to define.
 */
export function expectAgreesWithStatechart(lifecycle: Lifecycle<string, string>): void {
  const machine = createMachine(lifecycle.statechart())
  expect(initialTransition(machine)[0].value).toBe(lifecycle.initial)
  for (const from of lifecycle.states) {
    const at = machine.resolveState({ value: from })
    expect(at.status === 'done', `${lifecycle.id}: ${from} final`).toBe(lifecycle.isFinal(from))
    for (const event of lifecycle.events) {
      const [after] = transition(machine, at, { type: event })
      const expected = lifecycle.next(from, event) ?? from
      expect(after.value, `${lifecycle.id}: ${from} on ${event}`).toBe(expected)
    }
  }
}

describe('defineLifecycle', () => {
  it('answers what a move leads to and where it may be asked', () => {
    expect(door.next('closed', 'lock')).toBe('locked')
    expect(door.next('locked', 'open')).toBeNull()
    expect(door.sourcesOf('remove')).toEqual(['closed', 'open'])
    expect(door.eventsFrom('open')).toEqual(['close', 'remove'])
    expect(door.statesThatMayBecome('closed')).toEqual(['open', 'locked'])
  })

  it('never lets a state move to itself, and names live and final states', () => {
    for (const state of door.states) expect(door.canTransition(state, state)).toBe(false)
    expect(door.canTransition('closed', 'open')).toBe(true)
    expect(door.canTransition('locked', 'open')).toBe(false)
    expect(door.finalStates).toEqual(['removed'])
    expect(door.liveStates).toEqual(['closed', 'open', 'locked'])
    expect(door.birthStates).toEqual(['closed', 'open'])
  })

  it('recognises its own states', () => {
    expect(door.isState('open')).toBe(true)
    expect(door.isState('ajar')).toBe(false)
    expect(door.isState(null)).toBe(false)
  })

  it('agrees with XState on every state and event', () => {
    expectAgreesWithStatechart(door)
  })

  it('refuses a config that is not a machine', () => {
    const declare = (states: Record<string, { on?: Record<string, string>; type?: 'final' }>) => () =>
      defineLifecycle({ id: 'broken', initial: 'a', states })
    expect(declare({ a: { on: { go: 'nowhere' } } })).toThrow(/undeclared state "nowhere"/)
    expect(declare({ a: { type: 'final', on: { go: 'b' } }, b: {} })).toThrow(/final state "a" has a move out/)
    expect(declare({ a: {}, island: {} })).toThrow(/state "island" is unreachable/)
  })

  it('draws as a Mermaid state diagram', () => {
    expect(lifecycleDiagram(door)).toBe(
      [
        'stateDiagram-v2',
        '  [*] --> closed',
        '  [*] --> open',
        '  closed --> open: open',
        '  closed --> locked: lock',
        '  closed --> removed: remove',
        '  open --> closed: close',
        '  open --> removed: remove',
        '  locked --> closed: unlock',
        '  removed --> [*]',
      ].join('\n')
    )
  })
})
