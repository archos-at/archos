import { replaceEqualDeep } from '@tanstack/react-query'
import { v4 as uuidv4 } from 'uuid'
import type { StageId, TurnView } from '@/lib/turns/turn-fold'
import type { ChatMessage } from '../types'
import { citationsFromWireList } from './wire-citation'
import { reconcileCardInteractions } from '@/features/cards/card-decision'
import { validateAnswerCards, type AnswerCard } from '@/shared/cards/schemas'
import { sanitizeAnswerMeta } from '@/lib/conversations/message-answer-meta'
import { isChatEffort } from '@/lib/reasoning-settings/catalog'
import { sanitizeRetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import { sanitizeQuoteStamps } from '@/lib/conversations/message-quote-stamps'
import { sanitizeConfidenceCheck } from '@/lib/conversations/confidence-check'
import { emptyRunLedger, sanitizeRunTitle } from '@/lib/runs/run-ledger'
import {
  sanitizeFollowUpsStage,
  sanitizeMemoryReflectionStage,
  type MessageStages,
} from '@/lib/conversations/message-stages'

const STAGES: { [K in StageId]: { key: keyof MessageStages; sanitize: (payload: unknown) => MessageStages[keyof MessageStages] | null } } = {
  follow_ups: { key: 'followUps', sanitize: sanitizeFollowUpsStage },
  memory_reflection: { key: 'memoryReflection', sanitize: sanitizeMemoryReflectionStage },
}

export const STAGE_COUNT = Object.keys(STAGES).length

const GROWS_THE_THREAD: ReadonlySet<StageId> = new Set(['follow_ups'])

export interface TurnProjection {
  messages: ChatMessage[]
  settled?: ChatMessage
  prompt?: ChatMessage
  stageWrites: MessageStages[]
}

export interface ProjectionContext {
  answerDurationMs?: number
  draft: string
}

const nonEmpty = <T>(list: T[] | null | undefined): T[] | undefined => (list && list.length > 0 ? list : undefined)

const hasSomethingToDraw = (view: TurnView): boolean =>
  Boolean(view.text.trim() || view.answerMeta || view.sources.length > 0) || view.cards.some(Boolean)

const cardsOf = (view: TurnView): (AnswerCard | undefined)[] | undefined =>
  view.cards.length === 0
    ? undefined
    : Array.from(view.cards, (keyed) => (keyed ? validateAnswerCards([keyed.card])[0] : undefined))

const resultFields = (view: TurnView): Partial<ChatMessage> => {
  const result = view.result
  if (!result) return {}
  const fields: Partial<ChatMessage> = {
    answerConfidence: result.answer_confidence ?? undefined,
    answerConfidenceCappedReason: result.answer_confidence_capped_reason ?? undefined,
    answerConfidenceReason: result.answer_confidence_reason ?? undefined,
    routingDecision: result.routing_decision ?? undefined,
    escalationReason: result.escalation_reason ?? undefined,
    citationsRemoved: result.citations_removed ?? undefined,
    readSources: nonEmpty(citationsFromWireList(result.read_sources)),
    researchTruncated: result.research_truncated ? true : undefined,
    skillsActivated: nonEmpty(result.skills_activated),
    skillsHidden: nonEmpty(result.skills_hidden),
    retrievalLedger: sanitizeRetrievalLedger(result.retrieval_ledger) ?? undefined,
    quoteStamps: sanitizeQuoteStamps(result.quote_stamps) ?? undefined,
    confidenceCheck: sanitizeConfidenceCheck(result.confidence_check),
    answerConfidenceVersion: result.answer_confidence_version ?? undefined,
    lookupFoundNothing: result.lookup_found_nothing ? true : undefined,
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined))
}

const answerOf = (
  existing: ChatMessage | undefined,
  view: TurnView,
  previous: TurnView | undefined,
  context: ProjectionContext
): ChatMessage => {
  const base: ChatMessage = existing ?? {
    id: view.messageId!,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    messageType: 'agent_response',
  }
  const patch: Partial<ChatMessage> = {}
  const put = <K extends keyof ChatMessage>(key: K, value: ChatMessage[K]): void => {
    if (base[key] !== value) patch[key] = value
  }
  const fresh = !existing || !previous
  put('content', view.text)
  put('isStreaming', view.phase === 'running' ? true : undefined)
  put('stopped', view.outcome === 'cancelled' ? true : undefined)
  put('failed', view.phase === 'failed' ? true : undefined)
  const reported = view.result?.reasoning_effort
  const ranAt = isChatEffort(reported) ? reported : view.effort
  if (ranAt) put('reasoningEffort', ranAt)
  if (fresh || previous.cards !== view.cards) {
    const cards = replaceEqualDeep(base.cards, cardsOf(view))
    if (cards !== base.cards) {
      patch.cards = cards
      patch.cardInteractions = reconcileCardInteractions(base.cardInteractions, base.cards, cards)
    }
  }
  if (fresh || previous.sources !== view.sources) put('citations', nonEmpty(citationsFromWireList(view.sources)))
  if (fresh || previous.answerMeta !== view.answerMeta) put('answerMeta', sanitizeAnswerMeta(view.answerMeta) ?? undefined)
  if (view.result && view.result !== previous?.result) {
    Object.assign(patch, resultFields(view))
    if (context.answerDurationMs !== undefined) patch.answerDurationMs = context.answerDurationMs
  }
  return Object.keys(patch).length === 0 ? base : { ...base, ...patch }
}

const PROVISIONAL_UPDATED_AT = new Date(0).toISOString()

export const provisionalRunMessage = (runId: string, messageId: string, question?: string): ChatMessage => {
  const runTitle = sanitizeRunTitle(question)
  return {
    id: messageId,
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    messageType: 'agent_response',
    runLedger: { ...emptyRunLedger(runId), updatedAt: PROVISIONAL_UPDATED_AT },
    ...(runTitle ? { runTitle } : {}),
  }
}

const promptOf = (view: TurnView): ChatMessage | undefined => {
  const request = view.interaction
  if (!request) return undefined
  return {
    id: uuidv4(),
    role: 'assistant',
    content: request.text,
    timestamp: new Date(),
    messageType: 'prompt',
    promptId: request.interaction_id,
    promptParentId: view.turnId,
    promptInputType: request.input,
    promptOptions: nonEmpty(request.options),
    promptPlaceholder: request.placeholder ?? undefined,
    isPromptResponded: false,
  }
}

const stagesOf = (
  view: TurnView,
  previous: TurnView | undefined,
  answerIsLast: boolean,
  context: ProjectionContext
): { stored: MessageStages[]; drawn: MessageStages } => {
  const stored: MessageStages[] = []
  const drawn: MessageStages = {}
  for (const [stage, value] of Object.entries(view.stages) as [StageId, NonNullable<TurnView['stages'][StageId]>][]) {
    if (value === previous?.stages[stage] || value.status !== 'ready') continue
    const { key, sanitize } = STAGES[stage]
    const payload = sanitize(value.payload)
    if (!payload) continue
    stored.push({ [key]: payload })
    const growthRefused =
      GROWS_THE_THREAD.has(stage) && (!answerIsLast || view.phase === 'running' || context.draft.trim().length > 0)
    if (!growthRefused) Object.assign(drawn, { [key]: payload })
  }
  return { stored, drawn }
}

export const projectTurn = (
  messages: ChatMessage[],
  view: TurnView,
  previous: TurnView | undefined,
  context: ProjectionContext
): TurnProjection => {
  let next = messages
  const edit = (): ChatMessage[] => (next === messages ? (next = [...messages]) : next)
  const projection: TurnProjection = { messages, stageWrites: [] }

  const question = messages.findIndex((message) => message.id === view.turnId)
  const stepsMoved = view.steps !== previous?.steps || view.stepOrder !== previous?.stepOrder
  if (question >= 0 && view.stepOrder.length > 0 && stepsMoved) {
    const steps = view.stepOrder.map((id) => view.steps[id]!)
    const held = messages[question]!.thinkingSteps
    const same = held?.length === steps.length && steps.every((step, index) => held[index] === step)
    if (!same) edit()[question] = { ...messages[question]!, thinkingSteps: steps }
  }

  const answerAt = view.messageId ? next.findIndex((message) => message.id === view.messageId) : -1
  const answeredElsewhere = Boolean(view.result?.run || view.result?.job_admission_rejected)
  const run = view.result?.run
  if (run) {
    const runAt = next.findIndex((message) => message.id === run.run_message_id)
    if (runAt < 0) {
      const asked = question >= 0 ? next[question]!.content : undefined
      const provisional = provisionalRunMessage(run.run_id, run.run_message_id, asked)
      if (answerAt >= 0) edit()[answerAt] = provisional
      else edit().push(provisional)
    } else if (answerAt >= 0) edit().splice(answerAt, 1)
  } else if (answeredElsewhere && answerAt >= 0) edit().splice(answerAt, 1)
  if (!answeredElsewhere && view.messageId && (answerAt >= 0 || hasSomethingToDraw(view))) {
    const existing = answerAt >= 0 ? next[answerAt] : undefined
    let answer = answerOf(existing, view, previous, context)
    const index = answerAt >= 0 ? answerAt : next.length
    const { stored, drawn } = stagesOf(view, previous, index >= next.length - 1, context)
    projection.stageWrites = stored
    if (Object.keys(drawn).length > 0) answer = { ...answer, stages: { ...answer.stages, ...drawn } }
    if (answer !== existing) edit()[index] = answer
    if (view.result && view.result !== previous?.result) projection.settled = answer
  }

  if (view.interaction && view.interaction !== previous?.interaction) {
    const asked = next.some((message) => message.messageType === 'prompt' && message.promptId === view.interaction?.interaction_id)
    const prompt = asked ? undefined : promptOf(view)
    if (prompt) {
      edit().push(prompt)
      projection.prompt = prompt
    }
  }

  projection.messages = next
  return projection
}
