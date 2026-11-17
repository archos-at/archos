/**
 * A lifecycle: the states one record can be in and every move between them,
 * declared once (ADR-0179). The shape is a statechart's (`id`, `initial`,
 * `states[state].on[event] = target`, `type: 'final'`), the one SCXML and
 * XState use, so the config is readable by anyone who knows either, draws in
 * their tools unchanged ({@link Lifecycle.statechart}) and is checked against
 * XState's own interpreter in `define-lifecycle.spec.ts`.
 *
 * It is a table and no runtime: a record's state lives in its row (or its
 * store), and a move is the writer's compare-and-set against
 * {@link Lifecycle.sourcesOf}. Nothing here holds state, runs effects or
 * schedules anything; work that takes time runs on the workflow engine
 * (ADR-0150), and its steps are not lifecycle states.
 *
 * Pure and dependency-free, so the server, the browser and a script read the
 * same answer.
 */

interface StateNode<S extends string, E extends string> {
  /** The moves out of this state: the event that asks for it, and the state it lands in. */
  readonly on?: { readonly [K in E]?: S }
  /** No move leaves a final state. */
  readonly type?: 'final'
}

export interface LifecycleConfig<S extends string, E extends string> {
  /** The record's name, one word per concept (`project`, `root-sort-run`). */
  readonly id: string
  /** The state a record is born in. */
  readonly initial: NoInfer<S>
  /** Further states a record may be born in, when a writer creates it past `initial`. */
  readonly bornAs?: readonly NoInfer<S>[]
  readonly states: { readonly [K in S]: StateNode<NoInfer<S>, E> }
}

/** One legal move. */
export interface LifecycleMove<S extends string, E extends string> {
  readonly from: S
  readonly event: E
  readonly to: S
}

export interface Lifecycle<S extends string, E extends string> {
  readonly id: string
  readonly initial: S
  /** Every state a record may be born in, `initial` first. */
  readonly birthStates: readonly S[]
  /** Every state, in the order declared. */
  readonly states: readonly S[]
  readonly events: readonly E[]
  /** Every legal move, in the order declared. */
  readonly moves: readonly LifecycleMove<S, E>[]
  /** The states no move leaves. */
  readonly finalStates: readonly S[]
  /** The states a move still leaves: what "open", "live" or "in work" means for this record. */
  readonly liveStates: readonly S[]
  isState(value: unknown): value is S
  isFinal(state: S): boolean
  /** Whether some move leads from `from` to `to`. A state never moves to itself. */
  canTransition(from: S, to: S): boolean
  /** The state `event` leads to from `from`, or null when that move does not exist. */
  next(from: S, event: E): S | null
  /** The events a record in `from` accepts. */
  eventsFrom(from: S): readonly E[]
  /** The states `event` may be asked in: what a writer's UPDATE matches on. */
  sourcesOf(event: E): readonly S[]
  /** The states that may become `to`, by any event. */
  statesThatMayBecome(to: S): readonly S[]
  /** The config as a statechart: `createMachine(lifecycle.statechart())` in XState, or any SCXML-shaped tool. */
  statechart(): { id: string; initial: S; states: Record<S, { on?: Partial<Record<E, S>>; type?: 'final' }> }
}

/**
 * Declare a lifecycle. Refuses, at module load, a config that cannot be a
 * machine: a move into a state that is not declared, a final state with a move
 * out, or a state nothing can reach.
 */
export function defineLifecycle<S extends string, E extends string>(config: LifecycleConfig<S, E>): Lifecycle<S, E> {
  const states = Object.keys(config.states) as S[]
  const nodeOf = (state: S): StateNode<S, E> => config.states[state]
  const moves: LifecycleMove<S, E>[] = states.flatMap((from) =>
    (Object.entries(nodeOf(from).on ?? {}) as [E, S][]).map(([event, to]) => ({ from, event, to }))
  )
  const birthStates = [config.initial, ...(config.bornAs ?? []).filter((state) => state !== config.initial)]
  const finalStates = states.filter((state) => nodeOf(state).type === 'final')
  const liveStates = states.filter((state) => moves.some((move) => move.from === state))
  const events = [...new Set(moves.map((move) => move.event))]
  const known = new Set<string>(states)

  assertWellFormed(config.id, { states, moves, birthStates, finalStates })

  return {
    id: config.id,
    initial: config.initial,
    birthStates,
    states,
    events,
    moves,
    finalStates,
    liveStates,
    isState: (value): value is S => typeof value === 'string' && known.has(value),
    isFinal: (state) => finalStates.includes(state),
    canTransition: (from, to) => from !== to && moves.some((move) => move.from === from && move.to === to),
    next: (from, event) => moves.find((move) => move.from === from && move.event === event)?.to ?? null,
    eventsFrom: (from) => moves.filter((move) => move.from === from).map((move) => move.event),
    sourcesOf: (event) => moves.filter((move) => move.event === event).map((move) => move.from),
    statesThatMayBecome: (to) => states.filter((from) => from !== to && moves.some((move) => move.from === from && move.to === to)),
    statechart: () => ({
      id: config.id,
      initial: config.initial,
      states: Object.fromEntries(
        states.map((state) => {
          const node = nodeOf(state)
          return [state, { ...(node.on ? { on: { ...node.on } } : {}), ...(node.type ? { type: node.type } : {}) }]
        })
      ) as Record<S, { on?: Partial<Record<E, S>>; type?: 'final' }>,
    }),
  }
}

function assertWellFormed<S extends string, E extends string>(
  id: string,
  machine: { states: readonly S[]; moves: readonly LifecycleMove<S, E>[]; birthStates: readonly S[]; finalStates: readonly S[] }
): void {
  const known = new Set<string>(machine.states)
  const problems: string[] = []
  for (const state of machine.birthStates) if (!known.has(state)) problems.push(`is born in undeclared state "${state}"`)
  for (const move of machine.moves) {
    if (!known.has(move.to)) problems.push(`"${move.from}" moves on "${move.event}" to undeclared state "${move.to}"`)
    if (machine.finalStates.includes(move.from)) problems.push(`final state "${move.from}" has a move out ("${move.event}")`)
  }
  const reached = new Set<string>(machine.birthStates)
  for (let grew = true; grew; ) {
    grew = false
    for (const move of machine.moves) {
      if (reached.has(move.from) && !reached.has(move.to)) {
        reached.add(move.to)
        grew = true
      }
    }
  }
  for (const state of machine.states) if (!reached.has(state)) problems.push(`state "${state}" is unreachable`)
  if (problems.length > 0) throw new Error(`Lifecycle "${id}" ${problems.join('; ')}.`)
}
