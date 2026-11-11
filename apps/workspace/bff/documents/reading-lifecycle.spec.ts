/**
 * @vitest-environment node
 */
/**
 * The declared moves of `documents.status` (ADR-0179), held to the three
 * things that already say something about them: a statechart interpreter, the
 * phases of `DOCUMENT_STATUS_FACTS`, and the quarantine rule of migrations 0122 and 0224.
 */
import { describe, expect, it } from 'vitest'
import { createMachine, transition } from 'xstate'
import { DOCUMENT_STATUSES, DOCUMENT_STATUS_FACTS, type DocumentStatus } from './document-status'
import { DOCUMENT_READING_LIFECYCLE as lifecycle, statusesAccepting } from './reading-lifecycle'

const phaseOf = (status: DocumentStatus) => DOCUMENT_STATUS_FACTS[status].phase
const inFlight = DOCUMENT_STATUSES.filter((status) => phaseOf(status) === 'in-flight')
const atRest = DOCUMENT_STATUSES.filter((status) => phaseOf(status) === 'terminal')
const notQuarantined = DOCUMENT_STATUSES.filter((status) => status !== 'quarantined')

describe('the reading lifecycle of a document', () => {
  it('means what a statechart says', () => {
    const machine = createMachine(lifecycle.statechart())
    for (const from of lifecycle.states) {
      const at = machine.resolveState({ value: from })
      for (const event of lifecycle.events) {
        const [after] = transition(machine, at, { type: event })
        expect(after.value, `${from} on ${event}`).toBe(lifecycle.next(from, event) ?? from)
      }
    }
  })

  it('declares the states the column may hold, in the same order', () => {
    expect(lifecycle.states).toEqual([...DOCUMENT_STATUSES])
  })

  it('has no final state: any document may be read again, replaced or archived', () => {
    expect(lifecycle.finalStates).toEqual([])
  })

  it('lets a quarantined row leave by a release or a re-screen and nothing else (migrations 0122, 0224)', () => {
    expect(lifecycle.eventsFrom('quarantined')).toEqual(['release', 'rescreen'])
    expect(lifecycle.next('quarantined', 'release')).toBe('uploaded')
    expect(lifecycle.next('quarantined', 'rescreen')).toBe('uploaded')
  })

  it.each(['dispatch', 'process', 'fail', 'unindex'] as const)(
    'accepts a %s on every row but a quarantined one',
    (event) => {
      expect(statusesAccepting(event)).toEqual(notQuarantined)
    },
  )
})

describe('the lifecycle and the phases of the status facts agree', () => {
  it('a row is born at rest', () => {
    for (const state of lifecycle.birthStates) expect(phaseOf(state), state).toBe('terminal')
  })

  it('an in-flight state is one a read may end from, well or badly', () => {
    for (const state of inFlight) {
      expect(lifecycle.canTransition(state, 'completed'), `${state} to completed`).toBe(true)
      expect(lifecycle.canTransition(state, 'failed'), `${state} to failed`).toBe(true)
    }
  })

  it('a job is stopped only while the row is in flight', () => {
    for (const state of lifecycle.sourcesOf('cancel')) expect(phaseOf(state), state).toBe('in-flight')
  })

  it('a reviewer releases a row at rest and never one in flight (`heldAtRest` reads the same phases)', () => {
    // `uploaded` is the target, so the row it lands on is not a move.
    expect(statusesAccepting('release')).toEqual(atRest)
  })

  it('a re-screen is asked of the same rows, the quarantined one included (migration 0224)', () => {
    expect(statusesAccepting('rescreen')).toEqual(atRest)
  })

  it('a verdict is the job’s: no state at rest becomes quarantined or cancelled', () => {
    for (const verdict of ['quarantined', 'cancelled'] as const) {
      for (const state of lifecycle.statesThatMayBecome(verdict)) expect(phaseOf(state), `${state} to ${verdict}`).toBe('in-flight')
    }
  })
})
