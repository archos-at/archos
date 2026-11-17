import type { AnswerCard } from '@/shared/cards/schemas'
import type { CitationSource } from '../../types'
import type { AnswerConfidenceCappedReason } from '@/lib/conversations/message-provenance'
import type { MessageStages } from '@/lib/conversations/message-stages'
import type { CardInteractions } from '@/features/cards/card-decision'
import type { AnswerMeta } from '@/lib/conversations/message-answer-meta'
import type { Finding, Findings } from '@/lib/conversations/message-findings'

import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'
import type { QuoteStamp } from '@/lib/conversations/message-quote-stamps'
import type { ConfidenceCheck } from '@/lib/conversations/confidence-check'

export interface AgentResponseProps {
  content: string
  timestamp?: Date | string
  answerDurationMs?: number
  variant?: 'default' | 'inline'
  cards?: (AnswerCard | undefined)[]
  citations?: CitationSource[]
  conversationId?: string | null
  cardInteractions?: CardInteractions
  stages?: MessageStages
  answerMeta?: AnswerMeta
  findings?: Findings
  previousFindings?: Findings
  onCommissionFinding?: (finding: Finding) => Promise<boolean>
  answerConfidence?: 'low' | 'medium' | 'high'
  answerConfidenceCappedReason?: AnswerConfidenceCappedReason
  answerConfidenceReason?: string
  confidenceCheck?: ConfidenceCheck
  answerConfidenceVersion?: 1 | 2
  lookupFoundNothing?: true
  citationsRemoved?: { count: number; reasons: string[] }
  readSources?: CitationSource[]
  researchTruncated?: true
  truncationReason?: string
  degradedReasons?: string[]
  skillsActivated?: string[]
  skillsHidden?: string[]
  showReasoning?: boolean
  messageId?: string
  isStreaming?: boolean
  routingDecision?: 'meta' | 'shallow' | 'deep' | 'error'
  readOnly?: boolean
  retrievalLedger?: RetrievalLedger
  quoteStamps?: QuoteStamp[]
  projectProfile?: unknown
  stopped?: boolean
  failed?: boolean
}
