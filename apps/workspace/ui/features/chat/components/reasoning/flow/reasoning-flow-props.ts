import type { CitationSource } from '../../../types'
import type { StoredThinkingStep } from '@/lib/conversations/message-provenance'
import { type CitedDocument } from '../../../lib/citations'
import type { RetrievalLedger } from '@/lib/conversations/message-retrieval-ledger'

export interface ReasoningFlowProps {
  steps: StoredThinkingStep[]
  userQuestion: string
  answerConfidence?: 'low' | 'medium' | 'high'
  citations?: CitationSource[]
  escalationReason?: string
  retrievalLedger?: RetrievalLedger
  live?: boolean
  sourceCards?: CitedDocument[]
}
