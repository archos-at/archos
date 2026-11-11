/**
 * @vitest-environment node
 *
 * The temporary switch's statechart (ADR-0180 rule 2): every state, every
 * move, and what the toggle, the line and the turn read in each. The rule
 * under test: the screen never says „keeps nothing" while the server row still
 * keeps, and a turn waits while the two differ.
 */
import { describe, expect, it } from 'vitest'
import { createActor, fromPromise, waitFor } from 'xstate'
import { temporarySwitchMachine, viewOf, type TemporarySwitchInput } from './temporary-switch-machine'

/** A machine whose PATCH answers `answer(temporary)`, or throws when it returns an Error. */
function start(input: TemporarySwitchInput, answer: (temporary: boolean) => boolean | Error = (temporary) => temporary) {
  const saves: boolean[] = []
  const refusals: unknown[] = []
  const machine = temporarySwitchMachine.provide({
    actors: {
      save: fromPromise<boolean, { temporary: boolean }>(async ({ input: request }) => {
        saves.push(request.temporary)
        const result = answer(request.temporary)
        if (result instanceof Error) throw result
        return result
      }),
    },
    actions: { notifyRefused: (_, { error }) => void refusals.push(error) },
  })
  const actor = createActor(machine, { input })
  actor.start()
  return { actor, saves, refusals }
}

type Harness = ReturnType<typeof start>

const view = (h: Pick<Harness, 'actor'>) => viewOf(h.actor.getSnapshot())
const state = (h: Pick<Harness, 'actor'>) => h.actor.getSnapshot().value
const settle = (h: Pick<Harness, 'actor'>) =>
  waitFor(h.actor, (snapshot) => !snapshot.matches('turningOn') && !snapshot.matches('turningOff'))

describe('starting', () => {
  it('a chat the server does not hold is a draft', () => {
    const h = start({ onServer: false, temporary: false })
    expect(state(h)).toBe('draft')
    expect(view(h)).toEqual({ pressed: false, pending: false, statement: null, sendBlocked: false })
  })

  it('a stored chat starts from its row: off or on', () => {
    expect(state(start({ onServer: true, temporary: false }))).toBe('off')
    expect(state(start({ onServer: true, temporary: true }))).toBe('on')
  })
})

describe('draft', () => {
  it('a switch is the create’s to carry: nothing is sent, nothing waits', () => {
    const h = start({ onServer: false, temporary: false })
    h.actor.send({ type: 'toggle', temporary: true })
    expect(state(h)).toBe('draft')
    expect(view(h)).toEqual({ pressed: true, pending: false, statement: 'temporary', sendBlocked: false })
    expect(h.saves).toEqual([])
  })

  it('the create leaving moves it to creating', () => {
    const h = start({ onServer: false, temporary: true })
    h.actor.send({ type: 'create.started', temporary: true })
    expect(state(h)).toBe('creating')
    expect(view(h).statement).toBe('temporary')
    expect(view(h).sendBlocked).toBe(false)
  })
})

describe('creating', () => {
  it('a row created as wanted settles without a PATCH', () => {
    const h = start({ onServer: false, temporary: true })
    h.actor.send({ type: 'create.started', temporary: true })
    h.actor.send({ type: 'row.created', temporary: true })
    expect(state(h)).toBe('on')
    expect(h.saves).toEqual([])
  })

  it('a row created off, as wanted, settles off', () => {
    const h = start({ onServer: false, temporary: false })
    h.actor.send({ type: 'create.started', temporary: false })
    h.actor.send({ type: 'row.created', temporary: false })
    expect(state(h)).toBe('off')
  })

  // The race the old chain of callbacks lost: the screen said „keeps nothing"
  // at once, the turn opened on the created row, and the PATCH followed.
  it('a switch on while the create is in flight is pending, blocks the turn, and is sent once the row exists', async () => {
    const h = start({ onServer: false, temporary: false })
    h.actor.send({ type: 'create.started', temporary: false })
    h.actor.send({ type: 'toggle', temporary: true })
    expect(view(h)).toEqual({ pressed: true, pending: false, statement: 'turningOn', sendBlocked: true })

    h.actor.send({ type: 'row.created', temporary: false })
    expect(state(h)).toBe('turningOn')
    expect(view(h)).toEqual({ pressed: true, pending: true, statement: 'turningOn', sendBlocked: true })

    await settle(h)
    expect(h.saves).toEqual([true])
    expect(state(h)).toBe('on')
    expect(view(h)).toEqual({ pressed: true, pending: false, statement: 'temporary', sendBlocked: false })
  })

  it('a switch off while a temporary create is in flight is sent once the row exists', async () => {
    const h = start({ onServer: false, temporary: true })
    h.actor.send({ type: 'create.started', temporary: true })
    h.actor.send({ type: 'toggle', temporary: false })
    expect(view(h).statement).toBe('turningOff')
    expect(view(h).sendBlocked).toBe(true)
    h.actor.send({ type: 'row.created', temporary: true })
    await settle(h)
    expect(h.saves).toEqual([false])
    expect(state(h)).toBe('off')
  })

  it('two switches during the create wait once and settle on the last word', () => {
    const h = start({ onServer: false, temporary: false })
    h.actor.send({ type: 'create.started', temporary: false })
    h.actor.send({ type: 'toggle', temporary: true })
    h.actor.send({ type: 'toggle', temporary: false })
    expect(view(h).sendBlocked).toBe(false)
    h.actor.send({ type: 'row.created', temporary: false })
    expect(state(h)).toBe('off')
    expect(h.saves).toEqual([])
  })

  it('a failed create goes back to a draft that keeps the last word', () => {
    const h = start({ onServer: false, temporary: false })
    h.actor.send({ type: 'create.started', temporary: false })
    h.actor.send({ type: 'toggle', temporary: true })
    h.actor.send({ type: 'create.failed' })
    expect(state(h)).toBe('draft')
    expect(view(h)).toEqual({ pressed: true, pending: false, statement: 'temporary', sendBlocked: false })
  })
})

describe('a stored chat', () => {
  it('off → turningOn → on, never optimistic', async () => {
    const h = start({ onServer: true, temporary: false })
    h.actor.send({ type: 'toggle', temporary: true })
    expect(view(h)).toEqual({ pressed: true, pending: true, statement: 'turningOn', sendBlocked: true })
    await settle(h)
    expect(state(h)).toBe('on')
  })

  it('on → turningOff → off', async () => {
    const h = start({ onServer: true, temporary: true })
    h.actor.send({ type: 'toggle', temporary: false })
    expect(view(h).statement).toBe('turningOff')
    await settle(h)
    expect(state(h)).toBe('off')
    expect(h.saves).toEqual([false])
  })

  it('a switch to what already holds does nothing', () => {
    const h = start({ onServer: true, temporary: true })
    h.actor.send({ type: 'toggle', temporary: true })
    expect(state(h)).toBe('on')
    expect(h.saves).toEqual([])
  })

  it('takes the server’s answer when it differs from the request', async () => {
    const h = start({ onServer: true, temporary: false }, () => false)
    h.actor.send({ type: 'toggle', temporary: true })
    await settle(h)
    expect(state(h)).toBe('off')
  })

  it('a row another tab switched is taken over in a settled state', () => {
    const h = start({ onServer: true, temporary: false })
    h.actor.send({ type: 'row.reported', temporary: true })
    expect(state(h)).toBe('on')
    h.actor.send({ type: 'row.reported', temporary: false })
    expect(state(h)).toBe('off')
  })
})

describe('failed', () => {
  it('a refused switch shows what the server holds, says so, and lets the person try again', async () => {
    const refusal = Object.assign(new Error('forbidden'), { status: 403 })
    let attempt = 0
    const h = start({ onServer: true, temporary: false }, (temporary) => (attempt++ === 0 ? refusal : temporary))
    h.actor.send({ type: 'toggle', temporary: true })
    await settle(h)
    expect(state(h)).toBe('failed')
    expect(h.refusals).toEqual([refusal])
    expect(view(h)).toEqual({ pressed: false, pending: false, statement: null, sendBlocked: false })

    h.actor.send({ type: 'toggle', temporary: true })
    await settle(h)
    expect(state(h)).toBe('on')
  })

  it('a failed PATCH after the create leaves the screen at the created row, never at the wish', async () => {
    const h = start({ onServer: false, temporary: false }, () => new Error('down'))
    h.actor.send({ type: 'create.started', temporary: false })
    h.actor.send({ type: 'toggle', temporary: true })
    h.actor.send({ type: 'row.created', temporary: false })
    await settle(h)
    expect(state(h)).toBe('failed')
    expect(view(h).statement).toBeNull()
    expect(h.refusals).toHaveLength(1)
  })

  it('a switch back to what holds just settles', async () => {
    const h = start({ onServer: true, temporary: true }, () => new Error('down'))
    h.actor.send({ type: 'toggle', temporary: false })
    await settle(h)
    expect(state(h)).toBe('failed')
    h.actor.send({ type: 'toggle', temporary: true })
    expect(state(h)).toBe('on')
    expect(h.saves).toEqual([false])
  })

  it('a row report in failed takes the server’s value', async () => {
    const h = start({ onServer: true, temporary: false }, () => new Error('down'))
    h.actor.send({ type: 'toggle', temporary: true })
    await settle(h)
    h.actor.send({ type: 'row.reported', temporary: true })
    expect(state(h)).toBe('on')
  })

  it('a switch off from failed goes through turningOff', async () => {
    let attempt = 0
    const h = start({ onServer: true, temporary: true }, (temporary) => (attempt++ === 0 ? new Error('down') : temporary))
    h.actor.send({ type: 'toggle', temporary: false })
    await settle(h)
    expect(state(h)).toBe('failed')
    expect(view(h).statement).toBe('temporary')
    h.actor.send({ type: 'toggle', temporary: false })
    expect(state(h)).toBe('turningOff')
    await settle(h)
    expect(state(h)).toBe('off')
  })
})
