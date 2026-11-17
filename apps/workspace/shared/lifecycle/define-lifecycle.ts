interface StateNode<S extends string, E extends string> {
  readonly on?: { readonly [K in E]?: S }
  readonly type?: 'final'
}

export interface LifecycleConfig<S extends string, E extends string> {
  readonly id: string
  readonly initial: NoInfer<S>
  readonly bornAs?: readonly NoInfer<S>[]
  readonly states: { readonly [K in S]: StateNode<NoInfer<S>, E> }
}

export interface LifecycleMove<S extends string, E extends string> {
  readonly from: S
  readonly event: E
  readonly to: S
}

export interface Lifecycle<S extends string, E extends string> {
  readonly id: string
  readonly initial: S
  readonly birthStates: readonly S[]
  readonly states: readonly S[]
  readonly events: readonly E[]
  readonly moves: readonly LifecycleMove<S, E>[]
  readonly finalStates: readonly S[]
  readonly liveStates: readonly S[]
  isState(value: unknown): value is S
  isFinal(state: S): boolean
  canTransition(from: S, to: S): boolean
  next(from: S, event: E): S | null
  eventsFrom(from: S): readonly E[]
  sourcesOf(event: E): readonly S[]
  statesThatMayBecome(to: S): readonly S[]
  statechart(): { id: string; initial: S; states: Record<S, { on?: Partial<Record<E, S>>; type?: 'final' }> }
}

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
