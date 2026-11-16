export interface ServerMessageInput {
  id: string
  role: string
  content: string
  createdAt: Date | string
  metadata?: unknown
  authorUserId?: string | null
}
import { CAPPED_REASONS, sanitizeThinkingSteps } from '@/lib/conversations/message-provenance'
import { sanitizeAnswerMeta } from '@/lib/conversations/message-answer-meta'
import { sanitizeFindings } from '@/lib/conversations/message-findings'
import { sanitizeRetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import { sanitizeQuoteStamps } from '@/lib/conversations/message-quote-stamps'
import { sanitizeConfidenceCheck } from '@/lib/conversations/confidence-check'
import { isChatEffort } from '@/lib/reasoning-settings/catalog'
import { sanitizeStages } from '@/lib/conversations/message-stages'
import { sanitizePromptOptions } from '@/lib/conversations/message-prompt'
import { sanitizeRunLedger, sanitizeRunTitle } from '@/lib/runs/run-ledger'

import type { AnswerConfidenceCappedReason } from '@/lib/conversations/message-provenance'
import type { ChatMessage, ErrorCardData, FileCardData, MessageType } from '../types'
import { validateAnswerCards } from '@/shared/cards/schemas'
import { sanitizeCardInteractions } from '@/features/cards/card-decision'
import { decodeCitations } from './citations'

const MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'user',
  'assistant',
  'status',
  'prompt',
  'agent_response',
  'file',
  'error',
])

const asMessageType = (value: unknown): MessageType | undefined =>
  typeof value === 'string' && MESSAGE_TYPES.has(value) ? (value as MessageType) : undefined

const asMentions = (value: unknown): ChatMessage['mentions'] | undefined => {
  if (!Array.isArray(value)) return undefined
  const mentions = value.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const { targetId, display } = entry as { targetId?: unknown; display?: unknown }
    if (typeof targetId !== 'string' || targetId.length === 0) return []
    return [{ targetId, display: typeof display === 'string' ? display : targetId }]
  })
  return mentions.length > 0 ? mentions : undefined
}

const asAddressees = (value: unknown): ChatMessage['addressees'] | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const { agent, users } = value as { agent?: unknown; users?: unknown }
  if (typeof agent !== 'boolean' || !Array.isArray(users)) return undefined
  return { agent, users: users.filter((user): user is string => typeof user === 'string') }
}

function markedAt(mark: unknown): string | undefined {
  if (typeof mark !== 'object' || mark === null || Array.isArray(mark)) return undefined
  const at = (mark as { at?: unknown }).at
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : undefined
}

export const mapServerMessageToChatMessage = (message: ServerMessageInput): ChatMessage | null => {
  if (message.role !== 'user' && message.role !== 'assistant') return null

  const metadata = (message.metadata ?? {}) as Record<string, unknown>

  const messageType =
    asMessageType(metadata.messageType) ?? (message.role === 'user' ? 'user' : 'agent_response')
  const timestamp = new Date(message.createdAt)
  const citations = decodeCitations(metadata.citations, timestamp)
  const readSources = decodeCitations(metadata.readSources, timestamp)

  return {
    id: String(message.id),
    role: message.role,
    content: message.content,
    timestamp,
    messageType,
    ...(message.authorUserId ? { authorUserId: message.authorUserId } : {}),
    ...(() => {
      const mentions = asMentions(metadata.mentions)
      return mentions ? { mentions } : {}
    })(),
    ...(() => {
      const addressees = asAddressees(metadata.addressees)
      return addressees ? { addressees } : {}
    })(),
    ...(citations ? { citations } : {}),
    ...(readSources ? { readSources } : {}),
    ...(metadata.errorData ? { errorData: metadata.errorData as ErrorCardData } : {}),
    ...(metadata.fileData ? { fileData: metadata.fileData as FileCardData } : {}),
    ...(Array.isArray(metadata.cards) ? { cards: validateAnswerCards(metadata.cards) } : {}),
    ...(() => {
      const answerMeta = sanitizeAnswerMeta(metadata.answerMeta)
      return answerMeta ? { answerMeta } : {}
    })(),
    ...(() => {
      const findings = sanitizeFindings(metadata.findings)
      return findings ? { findings } : {}
    })(),
    ...(() => {
      const ledger = sanitizeRetrievalLedger(metadata.retrieval_ledger)
      return ledger ? { retrievalLedger: ledger } : {}
    })(),
    ...(() => {
      const stamps = sanitizeQuoteStamps(metadata.quote_stamps)
      return stamps ? { quoteStamps: stamps } : {}
    })(),
    ...(() => {
      const runLedger = sanitizeRunLedger(metadata.run_ledger)
      return runLedger ? { runLedger } : {}
    })(),
    ...(() => {
      const runTitle = sanitizeRunTitle(metadata.run_title)
      return runTitle ? { runTitle } : {}
    })(),
    ...(() => {
      const interactions = sanitizeCardInteractions(metadata.cardInteractions)
      return interactions ? { cardInteractions: interactions } : {}
    })(),
    ...(Array.isArray(metadata.enabledDataSources)
      ? { enabledDataSources: metadata.enabledDataSources as string[] }
      : {}),
    ...(Array.isArray(metadata.messageFiles)
      ? { messageFiles: metadata.messageFiles as Array<{ id: string; fileName: string }> }
      : {}),
    ...(() => {
      const stages = sanitizeStages(metadata.stages)
      return stages ? { stages } : {}
    })(),
    ...(() => {
      const at = markedAt(metadata.sourceDeleted)
      return at ? { sourceDeletedAt: at } : {}
    })(),
    ...(() => {
      const at = markedAt(metadata.sourceRemoved)
      return at ? { erasedAt: at } : {}
    })(),
    ...restoreProvenance(metadata.provenance),
    ...restorePrompt(metadata.prompt, metadata.promptState),
  }
}

const restorePrompt = (prompt: unknown, promptState: unknown): Partial<ChatMessage> => {
  const out: Partial<ChatMessage> = {}

  if (typeof prompt === 'object' && prompt !== null && !Array.isArray(prompt)) {
    const detail = prompt as Record<string, unknown>
    if (typeof detail.promptId === 'string') out.promptId = detail.promptId
    if (typeof detail.promptParentId === 'string') out.promptParentId = detail.promptParentId
    if (detail.promptInputType === 'text' || detail.promptInputType === 'choice') {
      out.promptInputType = detail.promptInputType
    }
    const options = sanitizePromptOptions(detail.promptOptions)
    if (options) out.promptOptions = options
    if (typeof detail.promptPlaceholder === 'string') {
      out.promptPlaceholder = detail.promptPlaceholder
    }
    if (typeof detail.promptFor === 'string') out.promptFor = detail.promptFor
  }

  if (typeof promptState === 'object' && promptState !== null && !Array.isArray(promptState)) {
    const answer = (promptState as { response?: unknown }).response
    if (typeof answer === 'string' && answer.length > 0) {
      out.promptResponse = answer
      out.isPromptResponded = true
    }
  }

  return out
}

const restoreProvenance = (value: unknown): Partial<ChatMessage> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const provenance = value as Record<string, unknown>
  const out: Partial<ChatMessage> = {}

  const steps = sanitizeThinkingSteps(provenance.thinkingSteps)
  if (steps) out.thinkingSteps = steps

  if (isConfidence(provenance.answerConfidence)) out.answerConfidence = provenance.answerConfidence
  if (typeof provenance.answerConfidenceReason === 'string') {
    out.answerConfidenceReason = provenance.answerConfidenceReason
  }
  if (isCappedReason(provenance.answerConfidenceCappedReason)) {
    out.answerConfidenceCappedReason = provenance.answerConfidenceCappedReason
  }
  if (isRoutingDecision(provenance.routingDecision)) {
    out.routingDecision = provenance.routingDecision
  }
  if (typeof provenance.escalationReason === 'string') {
    out.escalationReason = provenance.escalationReason
  }
  if (
    typeof provenance.answerDurationMs === 'number' &&
    Number.isFinite(provenance.answerDurationMs) &&
    provenance.answerDurationMs > 0
  ) {
    out.answerDurationMs = provenance.answerDurationMs
  }
  if (isChatEffort(provenance.reasoningEffort)) out.reasoningEffort = provenance.reasoningEffort
  if (Array.isArray(provenance.skillsActivated) && provenance.skillsActivated.length > 0) {
    out.skillsActivated = provenance.skillsActivated.filter(
      (s): s is string => typeof s === 'string'
    )
  }
  if (Array.isArray(provenance.skillsHidden) && provenance.skillsHidden.length > 0) {
    out.skillsHidden = provenance.skillsHidden.filter((s): s is string => typeof s === 'string')
  }
  if (
    typeof provenance.citationsRemoved === 'object' &&
    provenance.citationsRemoved !== null &&
    typeof (provenance.citationsRemoved as { count?: unknown }).count === 'number'
  ) {
    out.citationsRemoved = provenance.citationsRemoved as { count: number; reasons: string[] }
  }
  if (provenance.researchTruncated === true) {
    out.researchTruncated = true
  }
  if (provenance.stopped === true) out.stopped = true
  if (typeof provenance.truncationReason === 'string' && provenance.truncationReason) {
    out.truncationReason = provenance.truncationReason
  }
  if (Array.isArray(provenance.degradedReasons) && provenance.degradedReasons.length > 0) {
    out.degradedReasons = provenance.degradedReasons.filter(
      (reason): reason is string => typeof reason === 'string' && reason.length > 0
    )
  }
  if (typeof provenance.deepResearchJobId === 'string') {
    out.deepResearchJobId = provenance.deepResearchJobId
  }
  const ledger = sanitizeRetrievalLedger(provenance.retrievalLedger)
  if (ledger) out.retrievalLedger = ledger
  const stamps = sanitizeQuoteStamps(provenance.quoteStamps)
  if (stamps) out.quoteStamps = stamps
  const check = sanitizeConfidenceCheck(provenance.confidenceCheck)
  if (check) out.confidenceCheck = check
  if (provenance.answerConfidenceVersion === 1 || provenance.answerConfidenceVersion === 2) {
    out.answerConfidenceVersion = provenance.answerConfidenceVersion
  }
  if (provenance.lookupFoundNothing === true) out.lookupFoundNothing = true

  return out
}

const isConfidence = (value: unknown): value is 'low' | 'medium' | 'high' =>
  value === 'low' || value === 'medium' || value === 'high'

const isRoutingDecision = (value: unknown): value is 'meta' | 'shallow' | 'deep' | 'error' =>
  value === 'meta' || value === 'shallow' || value === 'deep' || value === 'error'

const isCappedReason = (value: unknown): value is AnswerConfidenceCappedReason =>
  CAPPED_REASONS.includes(value as AnswerConfidenceCappedReason)

export const mapServerMessagesToChatMessages = (messages: ServerMessageInput[]): ChatMessage[] =>
  messages
    .map(mapServerMessageToChatMessage)
    .filter((message): message is ChatMessage => message !== null)
