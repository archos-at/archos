import type { ShownAnswer, TurnResult, WireEvent } from '@/adapters/api/wire-v2'
import type {
  StoredActionCounts,
  StoredThinkingStep,
  TraceLaneCard,
} from '@/lib/conversations/message-provenance'
import type { ChatEffort } from '@/lib/reasoning-settings/catalog'
import { KIND_TO_SIGNAL, asShelf } from '@/lib/source-kinds'
import { sharedPrefixChars, stoppedAnswer } from './stopped-answer'

type Named<N extends string> = Extract<WireEvent, { type: 'CUSTOM'; name: N }>
type StepOf<K extends string> = Extract<Extract<WireEvent, { type: 'STEP_FINISHED' }>['step'], { kind: K }>

export type KeyedCard = NonNullable<TurnResult['cards']>[number]
export type WireSource = NonNullable<TurnResult['sources']>[number]
export type InteractionRequestValue = Named<'interaction_request'>['value']
export type StageValue = Named<'stage'>['value']
export type StageId = StageValue['stage']
export type TurnOutcome = Extract<WireEvent, { type: 'RUN_FINISHED' }>['outcome']

export interface SteerView {
  text: string
  round?: number
}

export interface TurnView {
  turnId: string
  conversationId: string
  messageId?: string
  lastSeq: number
  gap: boolean
  phase: 'running' | 'finished' | 'failed'
  outcome?: TurnOutcome
  streaming: boolean
  text: string
  settled?: string
  sources: WireSource[]
  answerMeta?: Record<string, unknown>
  cards: (KeyedCard | null | undefined)[]
  steps: Record<string, StoredThinkingStep>
  stepOrder: string[]
  interaction?: InteractionRequestValue
  stages: Partial<Record<StageId, StageValue>>
  lastBeatAt?: number
  beatEveryMs?: number
  result?: TurnResult
  error?: { code: string; message: string }
  effort?: ChatEffort
  shownAtStop?: string
  stoppedLate?: boolean
  steers?: Record<string, SteerView>
  viewerActions?: ViewerActionValue[]
}

export type ViewerActionValue = Named<'viewer_action'>['value']

export const initialTurnView = (turnId: string, conversationId: string): TurnView => ({
  turnId,
  conversationId,
  lastSeq: 0,
  gap: false,
  phase: 'running',
  streaming: false,
  text: '',
  sources: [],
  cards: [],
  steps: {},
  stepOrder: [],
  stages: {},
})

const some = <K extends string, V>(name: K, value: V | null | undefined): Partial<Record<K, V>> => {
  const empty =
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && Object.keys(value).length === 0)
  return empty ? {} : ({ [name]: value } as Record<K, V>)
}

const lanesOf = (step: StepOf<'sources'>): TraceLaneCard[] =>
  step.lanes.map((lane) => ({
    key: lane.key,
    label: lane.label,
    hitCount: lane.hit_count,
    kind: lane.kind,
    signal: KIND_TO_SIGNAL[lane.kind],
    sources: lane.sources.map((hit) => ({
      name: hit.name,
      ...some('title', hit.title),
      ...some('detail', hit.detail),
      ...some('shelf', asShelf(hit.shelf)),
      ...some('round', hit.round),
    })),
  }))

const storedFields = (step: StepOf<string>, previous?: StoredThinkingStep): Partial<StoredThinkingStep> => {
  switch (step.kind) {
    case 'status':
      return {
        slot: step.slot,
        ...(step.channel === 'live' && step.key ? { turnEvent: { key: step.key, ...some('values', step.values) } } : {}),
        ...some('detail', step.detail),
      }
    case 'retrieval':
      return {
        round: step.round,
        turnEvent: { key: step.key, ...some('values', step.values), ...some('reason', step.reason), ...some('tools', step.tools) },
        ...(step.prefetch ? { detail: { prefetch: true } } : {}),
      }
    case 'sources':
      return { tool: step.tool, traceLanes: lanesOf(step), ...some('round', step.round), ...some('callId', step.call_id) }
    case 'tool':
      return {
        tool: step.tool,
        ...(step.status === 'error' || step.mount
          ? { detail: { ...(step.status === 'error' ? { status: 'error' } : {}), ...some('mount', step.mount) } }
          : {}),
      }
    case 'skill': {
      const live = step.phase === 'activated' && step.channel === 'live' && !step.hidden && step.title
      return {
        ...some('skill', step.skill),
        ...(live ? { turnEvent: { key: 'skill.activated', values: { skill: live } } } : {}),
        detail: {
          phase: step.phase,
          hidden: step.hidden,
          ...some('count', step.count),
          ...some('title', step.title ?? previous?.detail?.title),
        },
      }
    }
    case 'clarification':
      return { detail: { max_turns: step.max_turns } }
    case 'look': {
      const [x, y, w, h] = step.region ?? []
      return {
        ...some('round', step.round),
        detail: {
          document: step.document_name,
          page: step.page,
          shelf: step.shelf,
          ...some('document_id', step.document_id),
          ...some('revision_id', step.revision_id),
          ...some('x', x),
          ...some('y', y),
          ...some('w', w),
          ...some('h', h),
          ...some('image_index', step.image_index),
          ...some('where', step.where),
          ...some('question', step.question),
          ...some('reading', step.reading),
        },
      }
    }
    case 'action':
      return {
        ...some('round', step.round),
        callId: step.call_id,
        action: {
          verb: step.verb,
          status: step.status,
          ...some('query', step.query),
          ...some('mode', step.mode),
          ...some('target', step.target),
          ...some('documentId', step.document_id),
          ...some('pages', step.pages),
          ...some('shelf', step.shelf),
          ...some('mount', step.mount),
          ...(step.incomplete ? { incomplete: true } : {}),
          ...(step.missing ? { missing: true } : {}),
          ...some('counts', actionCountsOf(step.counts)),
          ...(step.elapsed_ms === null ? {} : { elapsedMs: step.elapsed_ms }),
        },
      }
    default:
      return {}
  }
}

const actionCountsOf = (counts: StepOf<'action'>['counts']): StoredActionCounts => ({
  ...some('hits', counts?.hits),
  ...some('documents', counts?.documents),
  ...some('searched', counts?.searched),
  ...some('files', counts?.files),
  ...some('folders', counts?.folders),
})

const startedAt = (event: Extract<WireEvent, { type: 'STEP_STARTED' | 'STEP_FINISHED' }>, previous?: StoredThinkingStep): string => {
  if (previous) return previous.timestamp
  const { step } = event
  const elapsed = step.kind === 'action' ? (step.elapsed_ms ?? 0) : 0
  return new Date(event.ts - elapsed).toISOString()
}

const foldStep = (view: TurnView, event: Extract<WireEvent, { type: 'STEP_STARTED' | 'STEP_FINISHED' }>): TurnView => {
  const { step } = event
  const previous = view.steps[step.id]
  const stored: StoredThinkingStep = {
    id: step.id,
    userMessageId: view.turnId,
    timestamp: startedAt(event, previous),
    isComplete: event.type === 'STEP_FINISHED',
    kind: step.kind,
    ...(step.scope === 'deep' ? { scope: 'deep' } : {}),
    ...some('subagentRunId', event.subagent_run_id),
    ...storedFields(step, previous),
  }
  return {
    ...view,
    steps: { ...view.steps, [step.id]: stored },
    stepOrder: previous ? view.stepOrder : [...view.stepOrder, step.id],
  }
}

export const subagentStepId = (runId: string): string => `subagent:${runId}`

export type SubagentStatus = 'running' | 'ok' | 'error'

const foldSubagent = (
  view: TurnView,
  event: Extract<WireEvent, { type: 'SUBAGENT_STARTED' | 'SUBAGENT_FINISHED' | 'SUBAGENT_ERROR' }>
): TurnView => {
  const id = subagentStepId(event.subagent_run_id)
  const previous = view.steps[id]
  if (previous?.isComplete) return view
  const started = event.type === 'SUBAGENT_STARTED' ? event : undefined
  const name = started?.name ?? (typeof previous?.detail?.name === 'string' ? previous.detail.name : 'subagent')
  const status: SubagentStatus =
    event.type === 'SUBAGENT_STARTED' ? 'running' : event.type === 'SUBAGENT_ERROR' ? 'error' : 'ok'
  const step: StoredThinkingStep = {
    id,
    userMessageId: view.turnId,
    timestamp: previous?.timestamp ?? new Date(event.ts).toISOString(),
    isComplete: status !== 'running',
    kind: 'status',
    slot: `subagent:${name}`,
    ...(previous?.subagentRunId ? { subagentRunId: previous.subagentRunId } : {}),
    ...some('subagentRunId', started?.parent_subagent_run_id),
    detail: {
      ...previous?.detail,
      name,
      status,
      ...some('description', started?.description),
      ...(event.type === 'SUBAGENT_ERROR' ? some('code', event.code) : {}),
    },
  }
  return {
    ...view,
    steps: { ...view.steps, [id]: step },
    stepOrder: previous ? view.stepOrder : [...view.stepOrder, id],
  }
}

const placeCard = (cards: TurnView['cards'], index: number, card: KeyedCard | null): TurnView['cards'] => {
  const current = cards[index]
  if (card && current && current.key === card.key) return cards
  const next = [...cards]
  next[index] = card
  return next
}

const settleCards = (cards: TurnView['cards'], final: readonly KeyedCard[]): KeyedCard[] => {
  const byKey = new Map(cards.filter((card): card is KeyedCard => Boolean(card)).map((card) => [card.key, card]))
  return final.map((card) => byKey.get(card.key) ?? card)
}

export const closeSteps = (steps: TurnView['steps']): TurnView['steps'] =>
  Object.values(steps).every((step) => step.isComplete)
    ? steps
    : Object.fromEntries(Object.entries(steps).map(([id, step]) => [id, step.isComplete ? step : { ...step, isComplete: true }]))

const stoppedHere = (view: TurnView): boolean => view.outcome === 'cancelled' && !view.result

const CONTENT_EVENTS: ReadonlySet<string> = new Set([
  'TEXT_MESSAGE_START',
  'TEXT_MESSAGE_CONTENT',
  'TEXT_MESSAGE_END',
  'STATE_SNAPSHOT',
  'masthead',
  'card',
  'card_refused',
  'answer_retracted',
  'viewer_action',
])

const sameCards = <T>(cards: T[], next: T[]): T[] =>
  cards.length === next.length && cards.every((card, index) => card === next[index]) ? cards : next

export const stopTurnView = (view: TurnView, shown: string | undefined): { view: TurnView; shown: ShownAnswer } => {
  const onScreen = shown !== undefined && view.text.startsWith(shown) ? shown : view.text
  const chars = Array.from(onScreen).length
  const kept = stoppedAnswer({ text: view.text, settled: view.settled, sources: view.sources, cards: view.cards }, chars)
  const stopped: TurnView = {
    ...view,
    text: kept.text,
    sources: kept.sources,
    cards: sameCards(view.cards, kept.cards),
    phase: 'finished',
    outcome: 'cancelled',
    streaming: false,
    interaction: undefined,
    shownAtStop: onScreen,
  }
  return { view: stopped, shown: { seq: view.lastSeq, chars } }
}

const stoppedLate = (view: TurnView, result: TurnResult): TurnView => {
  const chars = sharedPrefixChars(view.shownAtStop ?? view.text, result.text)
  const kept = stoppedAnswer(
    { text: result.text, settled: result.text, sources: result.sources ?? [], cards: result.cards ?? [] },
    chars
  )
  return {
    ...view,
    text: kept.text,
    sources: kept.sources,
    answerMeta: result.answer_meta ?? undefined,
    cards: settleCards(view.cards, kept.cards),
    stoppedLate: true,
  }
}

const afterLocalStop = (view: TurnView, event: WireEvent): TurnView | undefined => {
  if (event.type === 'RUN_FINISHED') {
    const closed = { ...view, result: event.result, steps: closeSteps(view.steps) }
    const elsewhere = Boolean(event.result.run || event.result.job_admission_rejected)
    return event.outcome === 'cancelled' || elsewhere ? closed : stoppedLate(closed, event.result)
  }
  if (event.type === 'RUN_ERROR') return { ...view, steps: closeSteps(view.steps) }
  return CONTENT_EVENTS.has(event.type === 'CUSTOM' ? event.name : event.type) ? view : undefined
}

const apply = (view: TurnView, event: WireEvent): TurnView => {
  const stopped = stoppedHere(view) ? afterLocalStop(view, event) : undefined
  if (stopped) return stopped
  switch (event.type) {
    case 'RUN_STARTED':
      return { ...view, messageId: event.message_id }
    case 'TEXT_MESSAGE_START':
      return { ...view, streaming: true }
    case 'TEXT_MESSAGE_CONTENT':
      return { ...view, streaming: true, text: view.text + event.delta }
    case 'TEXT_MESSAGE_END':
      return { ...view, streaming: false }
    case 'STATE_SNAPSHOT':
      return {
        ...view,
        text: event.snapshot.text,
        settled: event.snapshot.text,
        sources: event.snapshot.sources ?? [],
        answerMeta: event.snapshot.answer_meta ?? undefined,
      }
    case 'STEP_STARTED':
    case 'STEP_FINISHED':
      return foldStep(view, event)
    case 'SUBAGENT_STARTED':
    case 'SUBAGENT_FINISHED':
    case 'SUBAGENT_ERROR':
      return foldSubagent(view, event)
    case 'RUN_FINISHED':
      return {
        ...view,
        phase: 'finished',
        outcome: event.outcome,
        result: event.result,
        streaming: false,
        text: event.result.text,
        sources: event.result.sources ?? [],
        answerMeta: event.result.answer_meta ?? undefined,
        cards: settleCards(view.cards, event.result.cards ?? []),
        interaction: undefined,
        steps: closeSteps(view.steps),
      }
    case 'RUN_ERROR':
      return {
        ...view,
        phase: 'failed',
        streaming: false,
        error: { code: event.code, message: event.message },
        interaction: undefined,
        steps: closeSteps(view.steps),
      }
    case 'CUSTOM':
      return applyCustom(view, event)
    case 'UNKNOWN':
      return view
  }
}

const applyCustom = (view: TurnView, event: Extract<WireEvent, { type: 'CUSTOM' }>): TurnView => {
  switch (event.name) {
    case 'masthead':
      return { ...view, answerMeta: event.value.answer_meta }
    case 'card': {
      const { index, key, card } = event.value
      return { ...view, cards: placeCard(view.cards, index, { key, card }) }
    }
    case 'card_refused':
      return { ...view, cards: placeCard(view.cards, event.value.index, null) }
    case 'answer_retracted':
      return { ...view, streaming: false, text: '', settled: undefined, sources: [], answerMeta: undefined, cards: [] }
    case 'heartbeat':
      return { ...view, lastBeatAt: event.ts, beatEveryMs: event.value.every_ms }
    case 'stage':
      return { ...view, stages: { ...view.stages, [event.value.stage]: event.value } }
    case 'interaction_request':
      return { ...view, interaction: event.value }
    case 'interaction_resolved':
      return view.interaction?.interaction_id === event.value.interaction_id ? { ...view, interaction: undefined } : view
    case 'rejected':
      return view
    case 'steer_received':
      return foldSteer(view, event.value.steer_id, { text: event.value.text }, event.ts)
    case 'steer_applied': {
      const known = view.steers?.[event.value.steer_id]
      return foldSteer(view, event.value.steer_id, { text: known?.text ?? '', round: event.value.round }, event.ts)
    }
    case 'viewer_action': {
      const known = view.viewerActions ?? []
      if (known.some((call) => call.tool_call_id === event.value.tool_call_id)) return view
      return { ...view, viewerActions: [...known, event.value] }
    }
  }
}

export const steerStepId = (steerId: string): string => `steer:${steerId}`

const foldSteer = (view: TurnView, steerId: string, steer: SteerView, ts: number): TurnView => {
  const id = steerStepId(steerId)
  const previous = view.steps[id]
  const applied = steer.round !== undefined
  const step: StoredThinkingStep = {
    id,
    userMessageId: view.turnId,
    timestamp: previous?.timestamp ?? new Date(ts).toISOString(),
    isComplete: applied,
    kind: 'status',
    slot: 'steer',
    turnEvent: {
      key: applied ? 'status.steer.applied' : 'status.steer.received',
      values: { text: steer.text, ...(applied ? { round: String(steer.round) } : {}) },
    },
  }
  return {
    ...view,
    steers: { ...view.steers, [steerId]: steer },
    steps: { ...view.steps, [id]: step },
    stepOrder: previous ? view.stepOrder : [...view.stepOrder, id],
  }
}

export const isSteerRead = (view: TurnView, steerId: string): boolean => view.steers?.[steerId]?.round !== undefined

export const foldTurnEvent = (view: TurnView | undefined, event: WireEvent): TurnView => {
  const current = view ?? initialTurnView(event.turn_id, event.conversation_id)
  if (event.seq === 0 || event.seq <= current.lastSeq) return current
  if (current.lastSeq > 0 && event.seq > current.lastSeq + 1) return current.gap ? current : { ...current, gap: true }
  return { ...apply(current, event), lastSeq: event.seq, gap: false }
}

export const foldTurnEvents = (view: TurnView | undefined, events: readonly WireEvent[]): TurnView | undefined =>
  events.reduce<TurnView | undefined>(foldTurnEvent, view)
