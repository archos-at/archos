import type { Shelf, SourceKind, SourceSignal } from '@/lib/source-kinds'
import { modernizeLane } from '@/lib/source-kinds'
import { modernizeTurnEventKey, modernizeTurnEventValueName } from './legacy-turn-event'
import type { RetrievalLedger } from './message-retrieval-ledger'
import { sanitizeRetrievalLedger } from './message-retrieval-ledger'
import { sanitizeQuoteStamps, type QuoteStamp } from './message-quote-stamps'
import { sanitizeConfidenceCheck, type ConfidenceCheck } from './confidence-check'
import { isChatEffort, type ChatEffort } from '@/lib/reasoning-settings/catalog'

export const STEP_KINDS = [
  'status',
  'retrieval',
  'sources',
  'tool',
  'skill',
  'clarification',
  'look',
  'action',
] as const
export type StepKind = (typeof STEP_KINDS)[number]

export const ACTION_VERBS = [
  'search',
  'list',
  'read',
  'look',
  'lookup',
  'law',
  'web',
  'model',
  'workspace',
] as const
export type ActionVerb = (typeof ACTION_VERBS)[number]

export const ACTION_STATUSES = ['running', 'ok', 'empty', 'error'] as const
export type ActionStatus = (typeof ACTION_STATUSES)[number]

export const ACTION_MODES = ['meaning', 'exact', 'regex'] as const
export type ActionMode = (typeof ACTION_MODES)[number]

export const ACTION_MOUNTS = ['project', 'office', 'chat', 'law', 'estate'] as const
export type ActionMount = (typeof ACTION_MOUNTS)[number]

export interface StoredActionCounts {
  hits?: number
  documents?: number
  searched?: number
  files?: number
  folders?: number
}

export interface StoredAction {
  verb: ActionVerb
  status: ActionStatus
  query?: string
  mode?: ActionMode
  target?: string
  documentId?: string
  pages?: string
  shelf?: string
  mount?: ActionMount
  incomplete?: boolean
  missing?: boolean
  counts?: StoredActionCounts
  elapsedMs?: number
}

export interface StoredTurnEvent {
  key: string
  values?: Record<string, string>
  reason?: string
  tools?: string[]
}

export interface TraceSourceHit {
  name: string
  title?: string
  detail?: string
  shelf?: Shelf
  round?: number
}

export interface TraceLaneCard {
  key: string
  label: string
  hitCount: number
  sources: TraceSourceHit[]
  kind?: SourceKind
  signal: SourceSignal
}

export interface StoredThinkingStep {
  id: string
  userMessageId: string
  timestamp: string
  isComplete: boolean
  kind: StepKind
  scope?: 'deep'
  turnEvent?: StoredTurnEvent
  traceLanes?: TraceLaneCard[]
  round?: number
  tool?: string
  skill?: string
  slot?: string
  detail?: Record<string, StepDetailValue>
  action?: StoredAction
  callId?: string
  subagentRunId?: string
}

export type StepDetailValue = string | number | boolean | string[]

export type AnswerConfidenceCappedReason = (typeof CAPPED_REASONS)[number]

export type TruncationReason = (typeof TRUNCATION_REASONS)[number]

export type AnswerDegradedReason = (typeof ANSWER_DEGRADED_REASONS)[number]

export interface MessageProvenance {
  thinkingSteps?: StoredThinkingStep[]
  answerConfidence?: 'low' | 'medium' | 'high'
  answerConfidenceCappedReason?: AnswerConfidenceCappedReason
  answerConfidenceReason?: string
  routingDecision?: 'meta' | 'shallow' | 'deep' | 'error'
  escalationReason?: string
  answerDurationMs?: number
  reasoningEffort?: ChatEffort
  skillsActivated?: string[]
  skillsHidden?: string[]
  citationsRemoved?: { count: number; reasons: string[] }
  researchTruncated?: true
  stopped?: true
  truncationReason?: TruncationReason
  degradedReasons?: AnswerDegradedReason[]
  deepResearchJobId?: string
  retrievalLedger?: RetrievalLedger
  quoteStamps?: QuoteStamp[]
  confidenceCheck?: ConfidenceCheck
  answerConfidenceVersion?: 1 | 2
  lookupFoundNothing?: true
}

export const MAX_THINKING_STEPS = 600
export const MAX_THINKING_STEPS_READ = 4 * MAX_THINKING_STEPS
const DROP_ORDER: Readonly<Record<StepKind, number>> = {
  status: 0,
  tool: 0,
  skill: 1,
  clarification: 1,
  retrieval: 1,
  look: 1,
  action: 2,
  sources: 2,
}
const dropTier = (step: StoredThinkingStep): number =>
  step.kind === 'status' && step.id.startsWith('subagent:') ? DROP_ORDER.action : DROP_ORDER[step.kind]
const MAX_REASON_CHARS = 600
const MAX_REMOVED_REASONS = 20
const MAX_REMOVED_REASON_CHARS = 120
const MAX_ANSWER_DURATION_MS = 7 * 24 * 60 * 60 * 1000
const MAX_SKILLS = 20
const MAX_SKILL_CHARS = 80
const MAX_TRACE_LANES = 40
const MAX_TURN_EVENT_KEY_CHARS = 64
const MAX_TURN_EVENT_VALUES = 8
const MAX_TURN_EVENT_VALUE_KEY_CHARS = 32
const MAX_TURN_EVENT_VALUE_CHARS = 64
const MAX_NAME_CHARS = 200
const MAX_ACTION_QUERY_CHARS = 160
const MAX_ACTION_TARGET_CHARS = 300
const MAX_ACTION_PAGES_CHARS = 40
const MAX_CALL_ID_CHARS = 64
const MAX_SUBAGENT_RUN_ID_CHARS = 64
const MAX_DETAIL_ENTRIES = 16
const MAX_DETAIL_VALUE_CHARS = 200

const CONFIDENCES = ['low', 'medium', 'high'] as const
export const CAPPED_REASONS = [
  'ungrounded',
  'quote_unverified',
  'law_unsettled',
  'open_point',
  'normative_claim_uncited',
  'measurement_only',
  'citation_fallback',
] as const
const ROUTING_DECISIONS = ['meta', 'shallow', 'deep', 'error'] as const
export const TRUNCATION_REASONS = [
  'wall_clock',
  'step_limit',
  'upstream_timeout',
  'user_requested',
] as const
export const ANSWER_DEGRADED_REASONS = [
  'no_report_file',
  'no_valid_citations',
  'cards_generation_failed',
  'basis_unread',
] as const

export const LEGACY_DEGRADED_REASON: Readonly<Record<string, AnswerDegradedReason>> = {
  grundlage_unread: 'basis_unread',
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const cap = (value: unknown, max: number): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined

const stringList = (value: unknown, maxItems: number, maxChars: number): string[] | undefined => {
  if (!Array.isArray(value)) return undefined
  const items = value
    .slice(0, maxItems)
    .map((item) => cap(item, maxChars))
    .filter((item): item is string => item !== undefined)
  return items.length > 0 ? items : undefined
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[]): T | undefined =>
  typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : undefined

const isStepKind = (value: unknown): value is StepKind =>
  typeof value === 'string' && (STEP_KINDS as readonly string[]).includes(value)

const nonNegativeInt = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined

function sanitizeDetail(input: unknown): Record<string, StepDetailValue> | undefined {
  if (!isRecord(input)) return undefined
  const detail: Record<string, StepDetailValue> = {}
  for (const [name, value] of Object.entries(input).slice(0, MAX_DETAIL_ENTRIES)) {
    const safeName = cap(name, MAX_TURN_EVENT_VALUE_KEY_CHARS)
    if (!safeName) continue
    if (typeof value === 'boolean') detail[safeName] = value
    else if (typeof value === 'number' && Number.isFinite(value)) detail[safeName] = value
    else if (typeof value === 'string') detail[safeName] = value.slice(0, MAX_DETAIL_VALUE_CHARS)
    else {
      const list = stringList(value, MAX_TURN_EVENT_VALUES, MAX_TURN_EVENT_VALUE_CHARS)
      if (list) detail[safeName] = list
    }
  }
  return Object.keys(detail).length > 0 ? detail : undefined
}

const ACTION_COUNT_KEYS = ['hits', 'documents', 'searched', 'files', 'folders'] as const

function sanitizeActionCounts(input: unknown): StoredActionCounts | undefined {
  if (!isRecord(input)) return undefined
  const counts: StoredActionCounts = {}
  for (const key of ACTION_COUNT_KEYS) {
    const value = nonNegativeInt(input[key])
    if (value !== undefined) counts[key] = value
  }
  return Object.keys(counts).length > 0 ? counts : undefined
}

const LEGACY_PLACE_ROOTS: ReadonlyArray<readonly [string, ActionMount]> = [
  ['/project/', 'project'],
  ['/office/', 'office'],
  ['/chat/', 'chat'],
  ['/law/oib/', 'law'],
  ['/law/', 'law'],
]

const placeOfPath = (path: string): Pick<StoredAction, 'mount' | 'target'> | null => {
  if (path === '/') return { mount: 'estate' }
  const root = LEGACY_PLACE_ROOTS.find(([prefix]) => `${path}/`.startsWith(prefix))
  if (!root) return null
  const [prefix, mount] = root
  const folder = mount === 'law' ? '' : `${path}/`.slice(prefix.length).replace(/\/+$/, '')
  return { mount, ...(folder ? { target: folder } : {}) }
}

export function legacyPlace(
  action: StoredAction
): Partial<Pick<StoredAction, 'verb' | 'mount' | 'target' | 'query'>> | null {
  if (action.mount) return null
  const target = action.target?.trim() ?? ''
  if (!target.startsWith('/')) return null
  if (action.verb === 'read') {
    const slash = target.lastIndexOf('/')
    const leaf = target.slice(slash + 1)
    if (/^readme\.md$/i.test(leaf)) {
      const folder = placeOfPath(target.slice(0, slash) || '/')
      return folder ? { verb: 'list', ...folder } : null
    }
    return leaf ? { target: leaf.replace(/(\.[a-z0-9]{1,5})\.md$/i, '$1') } : null
  }
  if (action.verb !== 'list' && action.verb !== 'search') return null
  const [path, pattern] = target.split(' · ', 2)
  const query = action.query ?? (pattern?.trim() || undefined)
  const place = placeOfPath(path)
  return place ? { ...place, ...(query ? { query } : {}) } : null
}

function sanitizeAction(input: unknown): StoredAction | null {
  if (!isRecord(input)) return null
  const verb = oneOf(input.verb, ACTION_VERBS)
  if (!verb) return null
  const action: StoredAction = { verb, status: oneOf(input.status, ACTION_STATUSES) ?? 'ok' }
  const query = cap(input.query, MAX_ACTION_QUERY_CHARS)
  if (query) action.query = query
  const mode = oneOf(input.mode, ACTION_MODES)
  if (mode) action.mode = mode
  const target = cap(input.target, MAX_ACTION_TARGET_CHARS)
  if (target) action.target = target
  const documentId = cap(input.documentId, 128)
  if (documentId) action.documentId = documentId
  const pages = cap(input.pages, MAX_ACTION_PAGES_CHARS)
  if (pages) action.pages = pages
  const shelf = cap(input.shelf, MAX_ACTION_PAGES_CHARS)
  if (shelf) action.shelf = shelf
  const mount = oneOf(input.mount, ACTION_MOUNTS)
  if (mount) action.mount = mount
  if (input.incomplete === true) action.incomplete = true
  if (input.missing === true && action.status === 'empty') action.missing = true
  const counts = sanitizeActionCounts(input.counts)
  if (counts) action.counts = counts
  const elapsedMs = nonNegativeInt(input.elapsedMs)
  if (elapsedMs !== undefined) action.elapsedMs = elapsedMs
  const legacy = legacyPlace(action)
  if (!legacy) return action
  const placed: StoredAction = { ...action, ...legacy }
  if (!legacy.target) delete placed.target
  return placed
}

const isTraceLane = (value: unknown): value is TraceLaneCard =>
  isRecord(value) &&
  typeof value.key === 'string' &&
  typeof value.label === 'string' &&
  typeof value.signal === 'string' &&
  typeof value.hitCount === 'number' &&
  Array.isArray(value.sources)

function sanitizeStep(input: unknown): StoredThinkingStep | null {
  if (!isRecord(input) || !isStepKind(input.kind)) return null
  const id = cap(input.id, 128)
  const userMessageId = cap(input.userMessageId, 128)
  if (!id || !userMessageId) return null

  const step: StoredThinkingStep = {
    id,
    userMessageId,
    timestamp:
      cap(input.timestamp, 40) ??
      (input.timestamp instanceof Date ? input.timestamp.toISOString() : ''),
    isComplete: input.isComplete === true,
    kind: input.kind,
  }
  if (input.scope === 'deep') step.scope = 'deep'
  const { turnEvent } = sanitizeTurnEvent(input.turnEvent)
  if (turnEvent) step.turnEvent = turnEvent
  const traceLanes = Array.isArray(input.traceLanes)
    ? input.traceLanes
        .slice(0, MAX_TRACE_LANES)
        .filter(isTraceLane)
        .map((lane) => ({
          ...lane,
          key: modernizeLane(lane.key) ?? lane.key,
          ...(lane.kind ? { kind: lane.kind as SourceKind } : {}),
        }))
    : []
  if (traceLanes.length > 0) step.traceLanes = traceLanes
  const round = nonNegativeInt(input.round)
  if (round !== undefined) step.round = round
  const tool = cap(input.tool, MAX_NAME_CHARS)
  if (tool) step.tool = tool
  const skill = cap(input.skill, MAX_SKILL_CHARS)
  if (skill) step.skill = skill
  const slot = cap(input.slot, MAX_TURN_EVENT_KEY_CHARS)
  if (slot) step.slot = slot
  const detail = sanitizeDetail(input.detail)
  if (detail) step.detail = detail
  const action = input.kind === 'action' ? sanitizeAction(input.action) : null
  if (action) step.action = action
  const callId =
    input.kind === 'action' || input.kind === 'sources' ? cap(input.callId, MAX_CALL_ID_CHARS) : undefined
  if (callId) step.callId = callId
  const subagentRunId = cap(input.subagentRunId, MAX_SUBAGENT_RUN_ID_CHARS)
  if (subagentRunId) step.subagentRunId = subagentRunId
  return step
}

export function sanitizeThinkingSteps(input: unknown): StoredThinkingStep[] | undefined {
  if (!Array.isArray(input)) return undefined
  const steps = boundSteps(
    input
      .slice(0, MAX_THINKING_STEPS_READ)
      .map(sanitizeStep)
      .filter((step): step is StoredThinkingStep => step !== null)
  )
  return steps.length > 0 ? steps : undefined
}

export function boundSteps(steps: readonly StoredThinkingStep[]): StoredThinkingStep[] {
  let excess = steps.length - MAX_THINKING_STEPS
  if (excess <= 0) return [...steps]
  const dropped = new Set<number>()
  const tiers = [...new Set(Object.values(DROP_ORDER))].sort((a, b) => a - b)
  for (const tier of tiers) {
    for (let index = 0; index < steps.length && excess > 0; index += 1) {
      if (dropTier(steps[index]) !== tier) continue
      dropped.add(index)
      excess -= 1
    }
  }
  return steps.filter((_, index) => !dropped.has(index))
}

function sanitizeTurnEvent(input: unknown): { turnEvent?: StoredThinkingStep['turnEvent'] } {
  if (!isRecord(input)) return {}
  const stored = cap(input.key, MAX_TURN_EVENT_KEY_CHARS)
  if (!stored) return {}
  const key = modernizeTurnEventKey(stored)
  const values: Record<string, string> = {}
  if (isRecord(input.values)) {
    for (const [name, value] of Object.entries(input.values).slice(0, MAX_TURN_EVENT_VALUES)) {
      const safeName = cap(modernizeTurnEventValueName(key, name), MAX_TURN_EVENT_VALUE_KEY_CHARS)
      const safeValue = cap(value, MAX_TURN_EVENT_VALUE_CHARS)
      if (safeName && safeValue !== undefined) values[safeName] = safeValue
    }
  }
  const reason = cap(input.reason, MAX_REASON_CHARS)
  const event: NonNullable<StoredThinkingStep['turnEvent']> = { key }
  if (Object.keys(values).length > 0) event.values = values
  if (reason) event.reason = reason
  if (Array.isArray(input.tools)) {
    const tools = input.tools
      .slice(0, MAX_TURN_EVENT_VALUES)
      .map((name) => cap(name, MAX_TURN_EVENT_VALUE_CHARS))
      .filter((name): name is string => Boolean(name))
    if (tools.length > 0) event.tools = tools
  }
  return { turnEvent: event }
}

export function sanitizeProvenance(input: unknown): MessageProvenance | null {
  if (!isRecord(input)) return null
  const out: MessageProvenance = {}

  const steps = sanitizeThinkingSteps(input.thinkingSteps)
  if (steps) out.thinkingSteps = steps

  const confidence = oneOf(input.answerConfidence, CONFIDENCES)
  if (confidence) out.answerConfidence = confidence

  const cappedReason = oneOf(input.answerConfidenceCappedReason, CAPPED_REASONS)
  if (cappedReason) out.answerConfidenceCappedReason = cappedReason

  const confidenceReason = cap(input.answerConfidenceReason, MAX_REASON_CHARS)
  if (confidenceReason) out.answerConfidenceReason = confidenceReason

  const routing = oneOf(input.routingDecision, ROUTING_DECISIONS)
  if (routing) out.routingDecision = routing

  const escalationReason = cap(input.escalationReason, MAX_REASON_CHARS)
  if (escalationReason) out.escalationReason = escalationReason

  if (
    typeof input.answerDurationMs === 'number' &&
    Number.isFinite(input.answerDurationMs) &&
    input.answerDurationMs > 0 &&
    input.answerDurationMs <= MAX_ANSWER_DURATION_MS
  ) {
    out.answerDurationMs = Math.round(input.answerDurationMs)
  }

  if (isChatEffort(input.reasoningEffort)) out.reasoningEffort = input.reasoningEffort

  const skillsActivated = stringList(input.skillsActivated, MAX_SKILLS, MAX_SKILL_CHARS)
  if (skillsActivated) out.skillsActivated = skillsActivated
  const skillsHidden = stringList(input.skillsHidden, MAX_SKILLS, MAX_SKILL_CHARS)
  if (skillsHidden) out.skillsHidden = skillsHidden

  if (isRecord(input.citationsRemoved) && typeof input.citationsRemoved.count === 'number') {
    const reasons = Array.isArray(input.citationsRemoved.reasons)
      ? input.citationsRemoved.reasons
          .slice(0, MAX_REMOVED_REASONS)
          .map((reason) => cap(reason, MAX_REMOVED_REASON_CHARS))
          .filter((reason): reason is string => reason !== undefined)
      : []
    out.citationsRemoved = {
      count: Math.max(0, Math.trunc(input.citationsRemoved.count)),
      reasons,
    }
  }

  if (input.researchTruncated === true) out.researchTruncated = true
  if (input.stopped === true) out.stopped = true

  const truncationReason = oneOf(input.truncationReason, TRUNCATION_REASONS)
  if (truncationReason) out.truncationReason = truncationReason

  if (Array.isArray(input.degradedReasons)) {
    const reasons = [
      ...new Set(
        input.degradedReasons
          .map((reason) =>
            oneOf(
              typeof reason === 'string' ? (LEGACY_DEGRADED_REASON[reason] ?? reason) : reason,
              ANSWER_DEGRADED_REASONS
            )
          )
          .filter((reason): reason is AnswerDegradedReason => reason !== undefined)
      ),
    ]
    if (reasons.length > 0) out.degradedReasons = reasons
  }

  const jobId = cap(input.deepResearchJobId, 128)
  if (jobId) out.deepResearchJobId = jobId

  const ledger = sanitizeRetrievalLedger(input.retrievalLedger)
  if (ledger) out.retrievalLedger = ledger

  const stamps = sanitizeQuoteStamps(input.quoteStamps)
  if (stamps) out.quoteStamps = stamps

  const check = sanitizeConfidenceCheck(input.confidenceCheck)
  if (check) out.confidenceCheck = check
  if (input.answerConfidenceVersion === 1 || input.answerConfidenceVersion === 2) {
    out.answerConfidenceVersion = input.answerConfidenceVersion
  }
  if (input.lookupFoundNothing === true) out.lookupFoundNothing = true

  return Object.keys(out).length > 0 ? out : null
}
